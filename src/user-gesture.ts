// Pure-heuristic detector for user-puppet body language. One instance
// per hand. Caller (the controller) feeds it the MediaPipe landmarks +
// already-computed mouthOpen and roll each frame; it produces one-shot
// gesture emissions, a sticky pose classification, an energy hint, and
// a recent-motion magnitude (used by main.ts to pick the "active" puppet).
//
// Designed for hackathon-grade reliability, not production: thresholds
// are conservative and tuned by eye. Live-tuning is expected.

import type { NormalizedLandmarkList, LandmarkList } from "@mediapipe/hands";
import type { UserGesture, UserPose, UserEnergy } from "../server/protocol.ts";

export type ObserveInput = {
  lm: NormalizedLandmarkList; // image-space [0,1]
  world: LandmarkList;        // metric, hand-centered
  mouthOpen: number;          // 0..1, computed by the controller
  roll: number;               // radians, smoothed by the controller
  dt: number;
};

// --- Tunables --------------------------------------------------------
const COOLDOWN_S = 2.5;            // min interval between same-gesture emissions
const GLOBAL_COOLDOWN_S = 0.6;     // min interval between any two gesture emissions
const STATIC_HOLD_S = 0.25;        // static gesture must be stable this long before emit
const WAVE_WINDOW_S = 1.5;
const WAVE_MIN_CROSSINGS = 3;
const WAVE_MIN_AMPLITUDE = 0.05;   // image-space x units (palm.x ∈ [0,1])
const JUMP_WINDOW_S = 0.5;
const JUMP_MIN_UP_VEL = 0.6;       // image-space y per second; y grows downward
const JUMP_MIN_DOWN_VEL = 0.3;
const POSE_HOLD_UPSIDE = 0.5;
const POSE_HOLD_SLEEPING = 3.0;
const SLEEP_MOTION_THRESHOLD = 0.05;
const ENERGY_HIGH_GESTURES: ReadonlySet<UserGesture> = new Set([
  "wave",
  "jump",
  "open_palm",
]);
const ENERGY_RECENCY_S = 2.0;
const FINGER_EXT_RATIO = 1.7;
const THUMB_EXT_RATIO = 1.4;
const ROLL_UPSIDE_TOLERANCE = 0.4; // ±0.4 rad of ±π
// ---------------------------------------------------------------------

export class GestureDetector {
  private buffer: UserGesture[] = [];
  private lastEmit: Partial<Record<UserGesture, number>> = {};
  private lastAnyEmit = -Infinity;
  private palmHistory: { t: number; x: number; y: number }[] = [];
  private staticCandidate: UserGesture | null = null;
  private staticHoldT = 0;
  private staticEmitted = false;
  private currentPose: UserPose = "normal";
  private poseCandidate: UserPose = "normal";
  private poseHoldT = 0;
  private clock = 0;
  private motionEMA = 0;
  private hasHand = false;

  /** Per-frame update with a hand visible. */
  observe(input: ObserveInput): void {
    this.clock += input.dt;
    this.hasHand = true;

    const palm = palmCenter(input.lm);
    this.palmHistory.push({ t: this.clock, x: palm.x, y: palm.y });
    while (this.palmHistory.length > 0 && this.clock - this.palmHistory[0]!.t > WAVE_WINDOW_S + 0.5) {
      this.palmHistory.shift();
    }

    if (this.palmHistory.length >= 2) {
      const prev = this.palmHistory[this.palmHistory.length - 2]!;
      const cur = this.palmHistory[this.palmHistory.length - 1]!;
      const mag = Math.hypot(cur.x - prev.x, cur.y - prev.y) / Math.max(input.dt, 1e-6);
      this.motionEMA += (mag - this.motionEMA) * (1 - Math.exp(-input.dt / 0.3));
    }

    // Static gesture: emit only after the same classification has held for
    // STATIC_HOLD_S, to suppress flicker around finger-extension thresholds.
    const staticG = classifyStatic(computeExtensions(input.world));
    if (staticG !== this.staticCandidate) {
      this.staticCandidate = staticG;
      this.staticHoldT = 0;
      this.staticEmitted = false;
    } else if (staticG !== null) {
      this.staticHoldT += input.dt;
      if (!this.staticEmitted && this.staticHoldT >= STATIC_HOLD_S) {
        if (this.tryEmit(staticG)) this.staticEmitted = true;
      }
    }

    // Dynamic gestures: window scans.
    if (this.detectWave()) this.tryEmit("wave");
    if (this.detectJump()) this.tryEmit("jump");

    // Pose: sticky classifier.
    this.updatePose(input);
  }

  /** Per-frame update when no hand is visible. Decays motion + ages
   *  the clock so cooldowns and pose timers still progress. */
  notifyAbsent(dt: number): void {
    this.clock += dt;
    this.hasHand = false;
    this.motionEMA *= Math.exp(-dt / 0.3);
    this.staticCandidate = null;
    this.staticHoldT = 0;
    this.staticEmitted = false;
    // Sleeping doesn't apply when the hand isn't even visible — pose
    // resets to normal so we don't carry stale state across reappearance.
    if (this.currentPose !== "normal") {
      this.currentPose = "normal";
      this.poseCandidate = "normal";
      this.poseHoldT = 0;
    }
  }

  drainGestures(): UserGesture[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  get pose(): UserPose {
    return this.currentPose;
  }

  /** Smoothed magnitude of recent palm motion. Used by main.ts to pick
   *  the active puppet when both hands are visible. Higher = more active. */
  get recentMotion(): number {
    return this.motionEMA;
  }

  get energy(): UserEnergy {
    if (!this.hasHand || this.currentPose === "sleeping") return "low";
    const recent = this.recentEmissions(ENERGY_RECENCY_S);
    if (recent.some((g) => ENERGY_HIGH_GESTURES.has(g))) return "high";
    if (recent.length > 0 || this.motionEMA > 0.1) return "med";
    return "low";
  }

  private tryEmit(g: UserGesture): boolean {
    const last = this.lastEmit[g] ?? -Infinity;
    if (this.clock - last < COOLDOWN_S) return false;
    if (this.clock - this.lastAnyEmit < GLOBAL_COOLDOWN_S) return false;
    this.buffer.push(g);
    this.lastEmit[g] = this.clock;
    this.lastAnyEmit = this.clock;
    return true;
  }

  private recentEmissions(windowS: number): UserGesture[] {
    const cutoff = this.clock - windowS;
    const out: UserGesture[] = [];
    for (const [g, t] of Object.entries(this.lastEmit)) {
      if (t !== undefined && t > cutoff) out.push(g as UserGesture);
    }
    return out;
  }

  private detectWave(): boolean {
    const win = this.palmHistory.filter((p) => this.clock - p.t < WAVE_WINDOW_S);
    if (win.length < 6) return false;
    let crossings = 0;
    let prevDx = 0;
    let amplitude = 0;
    const x0 = win[0]!.x;
    for (let i = 1; i < win.length; i++) {
      const dx = win[i]!.x - win[i - 1]!.x;
      if (i > 1 && prevDx * dx < 0 && Math.abs(dx) > 0.002) crossings++;
      prevDx = dx;
      amplitude = Math.max(amplitude, Math.abs(win[i]!.x - x0));
    }
    return crossings >= WAVE_MIN_CROSSINGS && amplitude > WAVE_MIN_AMPLITUDE;
  }

  private detectJump(): boolean {
    const win = this.palmHistory.filter((p) => this.clock - p.t < JUMP_WINDOW_S);
    if (win.length < 4) return false;
    let peakUp = 0; // most-negative dy/dt (image y grows downward)
    let peakDown = 0;
    let upTime = -1;
    let downTime = -1;
    for (let i = 1; i < win.length; i++) {
      const dt = win[i]!.t - win[i - 1]!.t;
      if (dt < 1e-6) continue;
      const vy = (win[i]!.y - win[i - 1]!.y) / dt;
      if (vy < peakUp) {
        peakUp = vy;
        upTime = win[i]!.t;
      }
      if (vy > peakDown) {
        peakDown = vy;
        downTime = win[i]!.t;
      }
    }
    return (
      -peakUp > JUMP_MIN_UP_VEL &&
      peakDown > JUMP_MIN_DOWN_VEL &&
      downTime > upTime
    );
  }

  private updatePose(input: ObserveInput): void {
    const candidate = classifyPose(
      input,
      this.motionEMA,
      this.recentEmissions(1.5).length,
    );
    if (candidate === this.currentPose) {
      this.poseCandidate = candidate;
      this.poseHoldT = 0;
      return;
    }
    if (candidate === "normal") {
      // Snap back to normal as soon as the trigger ends.
      this.currentPose = "normal";
      this.poseCandidate = "normal";
      this.poseHoldT = 0;
      return;
    }
    if (candidate === this.poseCandidate) {
      this.poseHoldT += input.dt;
      const required = candidate === "upside_down" ? POSE_HOLD_UPSIDE : POSE_HOLD_SLEEPING;
      if (this.poseHoldT >= required) {
        this.currentPose = candidate;
        this.poseHoldT = 0;
      }
    } else {
      this.poseCandidate = candidate;
      this.poseHoldT = 0;
    }
  }
}

// ---- helpers --------------------------------------------------------

function palmCenter(lm: NormalizedLandmarkList): { x: number; y: number } {
  const ix = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const i of ix) {
    x += lm[i]!.x;
    y += lm[i]!.y;
  }
  return { x: x / ix.length, y: y / ix.length };
}

type FingerExt = readonly [boolean, boolean, boolean, boolean, boolean];

function computeExtensions(world: LandmarkList): FingerExt {
  const wrist = world[0]!;
  const dist = (a: { x: number; y: number; z: number }) =>
    Math.hypot(a.x - wrist.x, a.y - wrist.y, a.z - wrist.z);
  const ratio = (tipIdx: number, mcpIdx: number) =>
    dist(world[tipIdx]!) / Math.max(dist(world[mcpIdx]!), 1e-5);
  return [
    ratio(4, 2) > THUMB_EXT_RATIO, // thumb: tip vs IP joint (thumb is shorter)
    ratio(8, 5) > FINGER_EXT_RATIO, // index
    ratio(12, 9) > FINGER_EXT_RATIO, // middle
    ratio(16, 13) > FINGER_EXT_RATIO, // ring
    ratio(20, 17) > FINGER_EXT_RATIO, // pinky
  ];
}

export function classifyStatic(ext: FingerExt): UserGesture | null {
  const [thumb, idx, mid, ring, pinky] = ext;
  if (thumb && !idx && !mid && !ring && !pinky) return "thumbs_up";
  if (idx && mid && !ring && !pinky) return "peace"; // thumb either way
  if (!thumb && !idx && !mid && !ring && !pinky) return "fist";
  if (thumb && idx && mid && ring && pinky) return "open_palm";
  if (!thumb && idx && !mid && !ring && !pinky) return "point";
  return null;
}

function classifyPose(input: ObserveInput, motion: number, recentGestures: number): UserPose {
  const rollAbs = Math.abs(input.roll);
  if (Math.abs(rollAbs - Math.PI) < ROLL_UPSIDE_TOLERANCE) return "upside_down";
  if (motion < SLEEP_MOTION_THRESHOLD && input.mouthOpen < 0.1 && recentGestures === 0) {
    return "sleeping";
  }
  return "normal";
}
