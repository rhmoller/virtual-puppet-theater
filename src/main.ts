import * as THREE from "three";
import type {
  Hands as HandsType,
  Results,
  NormalizedLandmarkList,
  LandmarkList,
} from "@mediapipe/hands";
import { Puppet } from "./puppet";

declare global {
  interface Window {
    Hands: new (config: { locateFile: (file: string) => string }) => HandsType;
  }
}

const video = document.getElementById("video") as HTMLVideoElement;
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const landmarkCanvas = document.getElementById("landmark-canvas") as HTMLCanvasElement;
const landmarkCtx = landmarkCanvas.getContext("2d")!;

landmarkCanvas.width = 200;
landmarkCanvas.height = 150;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const SCENE_BG = new THREE.Color(0x000000);
scene.background = SCENE_BG;

let debug = false;
function setDebug(on: boolean) {
  debug = on;
  document.body.classList.toggle("debug", debug);
  scene.background = debug ? null : SCENE_BG;
}
window.addEventListener("keydown", (e) => {
  if (e.key === "d" || e.key === "D") setDebug(!debug);
});

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 8);

scene.add(new THREE.AmbientLight(0xffffff, 0.25));
const key = new THREE.DirectionalLight(0xfff2d8, 1.4);
key.position.set(3, 4, 5);
scene.add(key);
const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
fill.position.set(-4, -1, 3);
scene.add(fill);

type HandLabel = "Left" | "Right";
const puppetSpecs: { hand: HandLabel; color: number }[] = [
  { hand: "Left", color: 0xd98b4f },
  { hand: "Right", color: 0x7fb3a0 },
];
const puppets = puppetSpecs.map((spec) => {
  const puppet = new Puppet(spec.color);
  puppet.root.visible = false;
  scene.add(puppet.root);
  return { ...spec, puppet };
});

function viewSize(z = 0) {
  const dist = camera.position.z - z;
  const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  return { w: h * camera.aspect, h };
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

type HandData = { lm: NormalizedLandmarkList; world: LandmarkList };
const handData: Record<HandLabel, HandData | null> = { Left: null, Right: null };

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],
  [13,17],[0,17],[17,18],[18,19],[19,20],
  [5,9],[9,17],
];
const COLORS: Record<HandLabel, string> = { Left: "#d98b4f", Right: "#7fb3a0" };

type GazeClass = "forward" | "left" | "right" | "up" | "down";

type SmoothState = {
  x: number; y: number; open: number;
  gazeX: number; gazeY: number; visible: number;
  roll: number;
  gazeClass: GazeClass;
};
const smoothed: SmoothState[] = puppets.map(() => ({
  x: 0, y: 0, open: 0, gazeX: 0, gazeY: 0, visible: 0, roll: 0,
  gazeClass: "forward",
}));

const GAZE_TARGETS: Record<GazeClass, [number, number]> = {
  forward: [0, 0],
  left: [-1, 0],
  right: [1, 0],
  up: [0, 1],
  down: [0, -1],
};

const posAlpha = 0.4;
const openAlpha = 0.5;
const gazeAlpha = 0.25;
const visAlpha = 0.2;
const rollAlpha = 0.25;

type V3 = { x: number; y: number; z: number };
const v3sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const v3len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const v3avg = (...ps: V3[]): V3 => {
  let x = 0, y = 0, z = 0;
  for (const p of ps) { x += p.x; y += p.y; z += p.z; }
  const n = ps.length;
  return { x: x / n, y: y / n, z: z / n };
};
const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

function at<T>(arr: T[], i: number): T {
  return arr[i] as T;
}

function drawHandLandmarks(lm: NormalizedLandmarkList, color: string) {
  const ctx = landmarkCtx;
  const w = landmarkCanvas.width;
  const h = landmarkCanvas.height;

  // Draw connections
  ctx.strokeStyle = color + "99";
  ctx.lineWidth = 1;
  for (const conn of HAND_CONNECTIONS) {
    const ia = conn[0] as number;
    const ib = conn[1] as number;
    const la = at(lm, ia);
    const lb = at(lm, ib);
    if (!la || !lb) continue;
    // Mirror x only to match the horizontally-flipped video
    const x0 = (1 - la.x) * w;
    const y0 = la.y * h;
    const x1 = (1 - lb.x) * w;
    const y1 = lb.y * h;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Draw middle finger MCP→tip (gaze direction)
  const middleMcp = at(lm, 9);
  const middleTip = at(lm, 12);
  if (middleMcp && middleTip) {
    const gx0 = (1 - middleMcp.x) * w;
    const gy0 = middleMcp.y * h;
    const gx1 = (1 - middleTip.x) * w;
    const gy1 = middleTip.y * h;
    ctx.beginPath();
    ctx.moveTo(gx0, gy0);
    ctx.lineTo(gx1, gy1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Highlight wrist, thumb tip, middle tip
  ctx.fillStyle = color;
  for (const idx of [0, 4, 12] as const) {
    const pt = at(lm, idx);
    if (!pt) continue;
    const x = (1 - pt.x) * w;
    const y = pt.y * h;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Draw landmark dots
  ctx.fillStyle = color;
  for (const pt of lm) {
    if (!pt) continue;
    const x = (1 - pt.x) * w;
    const y = pt.y * h;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLandmarks() {
  const w = landmarkCanvas.width;
  const h = landmarkCanvas.height;
  landmarkCtx.clearRect(0, 0, w, h);

  for (const hand of ["Left", "Right"] as HandLabel[]) {
    const data = handData[hand];
    if (!data) continue;
    drawHandLandmarks(data.lm, COLORS[hand]);
  }
}

function updatePuppet(i: number) {
  const spec = puppets[i]!;
  const s = smoothed[i]!;
  const data = handData[spec.hand];
  const targetVisible = data ? 1 : 0;
  s.visible += (targetVisible - s.visible) * visAlpha;

  if (data) {
    const { lm, world } = data;

    // Position from image-space palm center (avg of wrist + four MCPs)
    // — averaging suppresses per-landmark jitter.
    const palmIm = {
      x: (lm[0]!.x + lm[5]!.x + lm[9]!.x + lm[13]!.x + lm[17]!.x) / 5,
      y: (lm[0]!.y + lm[5]!.y + lm[9]!.y + lm[13]!.y + lm[17]!.y) / 5,
    };
    const { w, h } = viewSize(0);
    const targetX = (0.5 - palmIm.x) * w;
    const targetY = (0.5 - palmIm.y) * h;

    // World-space geometry — metric, depth-invariant.
    const wristW = at(world, 0);
    const thumbTipW = at(world, 4);
    const mcpAvgW = v3avg(world[5]!, world[9]!, world[13]!, world[17]!);
    const palmW = v3avg(world[0]!, world[5]!, world[9]!, world[13]!, world[17]!);
    const fingersTipW = v3avg(world[8]!, world[12]!, world[16]!, world[20]!);

    // Mouth open: angle between (thumb_tip - palm) and (fingers_tip_avg - palm).
    // Closed sock-puppet ≈ 0.3 rad, wide open ≈ 1.4 rad.
    const tVec = v3sub(thumbTipW, palmW);
    const fVec = v3sub(fingersTipW, palmW);
    const cosA = (tVec.x * fVec.x + tVec.y * fVec.y + tVec.z * fVec.z) /
      Math.max(v3len(tVec) * v3len(fVec), 1e-5);
    const angle = Math.acos(Math.min(1, Math.max(-1, cosA)));
    // Bias toward closed: wider dead-zone at the low end, so small
    // angles read as fully closed; only reach 1 at a clearly-open angle.
    const targetOpen = Math.min(1, Math.max(0, (angle - 0.7) / 0.6));

    const fwd = v3sub(mcpAvgW, wristW);
    const fmag = Math.hypot(fwd.x, fwd.y);

    // Gaze: project the palm normal into the image plane. side × forward
    // points out of the palm toward the camera when palm faces camera, so
    // its xy projection vanishes there and grows as the hand yaws/pitches.
    // Sign flips for the Left hand because the across-palm axis reverses.
    const side = v3sub(world[17]!, world[5]!);
    const sign = spec.hand === "Left" ? -1 : 1;
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
    const ENTER = 0.45;
    const EXIT = 0.30;
    const dominant = (): GazeClass =>
      Math.abs(nxs) >= Math.abs(nys)
        ? nxs > 0 ? "right" : "left"
        : nys > 0 ? "up" : "down";
    if (s.gazeClass === "forward") {
      if (nmag > ENTER) s.gazeClass = dominant();
    } else if (nmag < EXIT) {
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

    s.x += (targetX - s.x) * posAlpha;
    s.y += (targetY - s.y) * posAlpha;
    s.open += (targetOpen - s.open) * openAlpha;
    s.gazeX += (targetGazeX - s.gazeX) * gazeAlpha;
    s.gazeY += (targetGazeY - s.gazeY) * gazeAlpha;
    s.roll += (targetRoll - s.roll) * rollAlpha;
  }

  const p = spec.puppet.root;
  p.visible = s.visible > 0.02;
  p.position.set(s.x, s.y, 0);
  p.rotation.z = s.roll;
  p.scale.setScalar(0.9 * Math.max(0.3, s.visible));
  spec.puppet.setOpen(s.open);
  spec.puppet.setGaze(s.gazeX, s.gazeY);
}

const hands = new window.Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.5,
});

const prevWrist: Record<"Left" | "Right", { x: number; y: number } | null> = {
  Left: null,
  Right: null,
};

hands.onResults((results: Results) => {
  handData.Left = null;
  handData.Right = null;
  if (!results.multiHandLandmarks || !results.multiHandedness) return;

  type Det = {
    lm: NormalizedLandmarkList;
    world: LandmarkList;
    modelLabel: "Left" | "Right";
  };
  const dets: Det[] = [];
  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const lm = results.multiHandLandmarks[i];
    const world = results.multiHandWorldLandmarks?.[i];
    const label = results.multiHandedness[i]?.label as "Left" | "Right" | undefined;
    if (lm && world && label) dets.push({ lm, world, modelLabel: label });
  }

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  };

  const assign: Partial<Record<"Left" | "Right", Det>> = {};
  if (dets.length === 2 && prevWrist.Left && prevWrist.Right) {
    const w0 = dets[0]!.lm[0]!;
    const w1 = dets[1]!.lm[0]!;
    const straight = dist(w0, prevWrist.Left) + dist(w1, prevWrist.Right);
    const swapped = dist(w1, prevWrist.Left) + dist(w0, prevWrist.Right);
    if (straight <= swapped) {
      assign.Left = dets[0]!;
      assign.Right = dets[1]!;
    } else {
      assign.Left = dets[1]!;
      assign.Right = dets[0]!;
    }
  } else if (dets.length === 1 && (prevWrist.Left || prevWrist.Right)) {
    const w = dets[0]!.lm[0]!;
    const dL = prevWrist.Left ? dist(w, prevWrist.Left) : Infinity;
    const dR = prevWrist.Right ? dist(w, prevWrist.Right) : Infinity;
    assign[dL <= dR ? "Left" : "Right"] = dets[0]!;
  } else {
    for (const d of dets) if (!assign[d.modelLabel]) assign[d.modelLabel] = d;
  }

  for (const side of ["Left", "Right"] as const) {
    const d = assign[side];
    if (d) {
      handData[side] = { lm: d.lm, world: d.world };
      prevWrist[side] = { x: d.lm[0]!.x, y: d.lm[0]!.y };
    } else {
      prevWrist[side] = null;
    }
  }
});

const loader = document.getElementById("loader")!;
const loaderBar = loader.querySelector(".loader-bar") as HTMLDivElement;
const loaderStart = performance.now();
let ready = false;
let displayed = 0;

function tickLoader() {
  const elapsed = (performance.now() - loaderStart) / 1000;
  const target = ready ? 100 : 90 * (1 - Math.exp(-elapsed / 1.8));
  displayed += (target - displayed) * 0.18;
  loaderBar.style.width = `${Math.min(100, displayed).toFixed(1)}%`;
  if (ready && displayed > 99.5) {
    loaderBar.style.width = "100%";
    loader.classList.add("done");
    setTimeout(() => loader.remove(), 500);
    return;
  }
  requestAnimationFrame(tickLoader);
}
tickLoader();

let cameraReady = false;
let sending = false;
async function frame() {
  if (cameraReady && !sending && video.readyState >= 2) {
    sending = true;
    hands.send({ image: video }).finally(() => {
      sending = false;
    });
  }
  for (let i = 0; i < puppets.length; i++) updatePuppet(i);
  drawLandmarks();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Kick off camera + MediaPipe asynchronously so rendering isn't blocked if
// camera permission is denied or MediaPipe fails to load.
(async () => {
  // Safety timeout so a hung init doesn't leave the user stuck on the loader.
  const timeout = setTimeout(() => { ready = true; }, 4000);
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("no getUserMedia");
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await video.play();
    await hands.initialize();
    cameraReady = true;
  } catch (err) {
    console.warn("Camera unavailable:", err);
  }
  clearTimeout(timeout);
  ready = true;
})();
