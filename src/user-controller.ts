import type { NormalizedLandmarkList, LandmarkList } from "@mediapipe/hands";
import { Ragdoll } from "./ragdoll";
import { Puppet } from "./puppet";

export type HandLabel = "Left" | "Right";
export type HandData = { lm: NormalizedLandmarkList; world: LandmarkList };
export type ViewSize = { w: number; h: number };

type GazeClass = "forward" | "left" | "right" | "up" | "down";

export type UserPuppetState = {
  x: number;
  y: number;
  open: number;
  gazeX: number;
  gazeY: number;
  visible: number;
  roll: number;
  gazeClass: GazeClass;
};

const GAZE_TARGETS: Record<GazeClass, [number, number]> = {
  forward: [0, 0],
  left: [-1, 0],
  right: [1, 0],
  up: [0, 1],
  down: [0, -1],
};

const POS_ALPHA = 0.4;
const OPEN_ALPHA = 0.5;
const GAZE_ALPHA = 0.25;
const VIS_ALPHA = 0.2;
const ROLL_ALPHA = 0.25;

// Gaze hysteresis thresholds: enter a directional class only above
// ENTER, fall back to forward only below EXIT. Wider gap = stickier.
const GAZE_ENTER = 0.45;
const GAZE_EXIT = 0.3;

type V3 = { x: number; y: number; z: number };
const v3sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const v3len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const v3avg = (...ps: V3[]): V3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of ps) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = ps.length;
  return { x: x / n, y: y / n, z: z / n };
};
const wrapAngle = (a: number) => {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
};

/**
 * Drives a hand-puppet rig from MediaPipe landmarks. Owns:
 *   - per-puppet smoothed state (position, roll, mouth open, gaze, visibility)
 *   - gaze classifier with hysteresis
 *   - the Ragdoll physics chain
 *
 * Frame loop: pass the latest hand data (or null) and the view size; the
 * controller updates the model's position, roll, mouth, and gaze, plus
 * steps the ragdoll while visible.
 */
export class UserPuppetController {
  private smoothed: UserPuppetState = {
    x: 0,
    y: 0,
    open: 0,
    gazeX: 0,
    gazeY: 0,
    visible: 0,
    roll: 0,
    gazeClass: "forward",
  };
  private ragdoll: Ragdoll;
  private wasVisible = false;

  constructor(
    public readonly model: Puppet,
    public readonly hand: HandLabel,
    private readonly puppetZ: number,
    private readonly depthScale: number,
  ) {
    this.ragdoll = new Ragdoll(model);
  }

  /** Snapshot of the current smoothed state (read-only). */
  get state(): Readonly<UserPuppetState> {
    return this.smoothed;
  }

  /** True once the smoothed visibility has crossed the show threshold. */
  get visible(): boolean {
    return this.smoothed.visible > 0.02;
  }

  update(dt: number, data: HandData | null, view: ViewSize): void {
    const s = this.smoothed;
    const targetVisible = data ? 1 : 0;
    s.visible += (targetVisible - s.visible) * VIS_ALPHA;

    if (data) {
      const { lm, world } = data;

      // Position from image-space palm center (avg of wrist + four MCPs).
      // Averaging suppresses per-landmark jitter.
      const palmIm = {
        x: (lm[0]!.x + lm[5]!.x + lm[9]!.x + lm[13]!.x + lm[17]!.x) / 5,
        y: (lm[0]!.y + lm[5]!.y + lm[9]!.y + lm[13]!.y + lm[17]!.y) / 5,
      };
      const targetX = (0.5 - palmIm.x) * view.w;
      const targetY = (0.5 - palmIm.y) * view.h;

      // World-space geometry — metric, depth-invariant.
      const wristW = world[0]!;
      const thumbTipW = world[4]!;
      const mcpAvgW = v3avg(world[5]!, world[9]!, world[13]!, world[17]!);
      const palmW = v3avg(world[0]!, world[5]!, world[9]!, world[13]!, world[17]!);
      const fingersTipW = v3avg(world[8]!, world[12]!, world[16]!, world[20]!);

      // Mouth open: angle between (thumb_tip - palm) and (fingers_tip_avg - palm).
      // Closed hand-puppet ≈ 0.3 rad, wide open ≈ 1.4 rad.
      const tVec = v3sub(thumbTipW, palmW);
      const fVec = v3sub(fingersTipW, palmW);
      const cosA =
        (tVec.x * fVec.x + tVec.y * fVec.y + tVec.z * fVec.z) /
        Math.max(v3len(tVec) * v3len(fVec), 1e-5);
      const angle = Math.acos(Math.min(1, Math.max(-1, cosA)));
      // Bias toward closed: wider dead-zone at the low end so small
      // angles read as fully closed; only reach 1 at a clearly-open angle.
      const targetOpen = Math.min(1, Math.max(0, (angle - 0.7) / 0.6));

      const fwd = v3sub(mcpAvgW, wristW);
      const fmag = Math.hypot(fwd.x, fwd.y);

      // Gaze: project the palm normal into the image plane. side × forward
      // points out of the palm toward the camera when palm faces camera, so
      // its xy projection vanishes there and grows as the hand yaws/pitches.
      // Sign flips for the Left hand because the across-palm axis reverses.
      const side = v3sub(world[17]!, world[5]!);
      const sign = this.hand === "Left" ? -1 : 1;
      const normal = {
        x: sign * (side.y * fwd.z - side.z * fwd.y),
        y: sign * (side.z * fwd.x - side.x * fwd.z),
        z: sign * (side.x * fwd.y - side.y * fwd.x),
      };
      // Project palm normal into screen space (mirror x for flipped webcam,
      // flip y for three.js y-up). Magnitude shrinks toward 0 as palm faces
      // the camera, grows as the hand yaws/pitches.
      const nlen = Math.max(v3len(normal), 1e-5);
      const nxs = -normal.x / nlen;
      const nys = -normal.y / nlen;
      const nmag = Math.hypot(nxs, nys);

      // Classify into {forward, left, right, up, down} with hysteresis.
      const dominant = (): GazeClass =>
        Math.abs(nxs) >= Math.abs(nys) ? (nxs > 0 ? "right" : "left") : nys > 0 ? "up" : "down";
      if (s.gazeClass === "forward") {
        if (nmag > GAZE_ENTER) s.gazeClass = dominant();
      } else if (nmag < GAZE_EXIT) {
        s.gazeClass = "forward";
      } else {
        // Allow switching between directional classes only on strong dominance.
        const next = dominant();
        const dom = Math.max(Math.abs(nxs), Math.abs(nys));
        const sub = Math.min(Math.abs(nxs), Math.abs(nys));
        if (next !== s.gazeClass && dom > sub * 1.5) s.gazeClass = next;
      }
      const [targetGazeX, targetGazeY] = GAZE_TARGETS[s.gazeClass];

      // Roll: angle that points the puppet's local +Y along the palm-forward
      // axis (wrist -> MCP center) projected into the image plane.
      let targetRoll = s.roll;
      if (fmag > 1e-5) {
        // atan2(fwd.x, -fwd.y) gives 0 when fingers point up the screen
        // (fwd.y < 0 in image coords). Both hands share this convention.
        const base = Math.atan2(fwd.x, -fwd.y);
        targetRoll = s.roll + wrapAngle(base - s.roll);
      }

      s.x += (targetX - s.x) * POS_ALPHA;
      s.y += (targetY - s.y) * POS_ALPHA;
      s.open += (targetOpen - s.open) * OPEN_ALPHA;
      s.gazeX += (targetGazeX - s.gazeX) * GAZE_ALPHA;
      s.gazeY += (targetGazeY - s.gazeY) * GAZE_ALPHA;
      s.roll += (targetRoll - s.roll) * ROLL_ALPHA;
    }

    const visible = this.visible;
    const root = this.model.root;
    root.visible = visible;
    root.position.set(s.x, s.y, this.puppetZ);
    this.model.setRoll(s.roll);
    root.scale.setScalar(0.9 * this.depthScale * Math.max(0.3, s.visible));
    this.model.setOpen(s.open);
    this.model.setGaze(s.gazeX, s.gazeY);

    if (visible && !this.wasVisible) this.ragdoll.reset();
    this.wasVisible = visible;
    if (visible) {
      this.ragdoll.update(dt);
      this.model.update(dt);
    }
  }
}
