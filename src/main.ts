import * as THREE from "three";
import type {
  Hands as HandsType,
  Results,
  NormalizedLandmarkList,
  LandmarkList,
} from "@mediapipe/hands";
import { Clawd } from "./clawd";
import { Puppet } from "./puppet";
import { Ragdoll } from "./ragdoll";
import { Theater } from "./theater";
import { Brain } from "./brain";
import type { Action, Gaze } from "../server/protocol.ts";

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

const theater = new Theater();
scene.add(theater.root);

let debug = false;
function setDebug(on: boolean) {
  debug = on;
  document.body.classList.toggle("debug", debug);
  scene.background = debug ? null : SCENE_BG;
  theater.setVisible(!debug);
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
  return { ...spec, puppet, ragdoll: new Ragdoll(puppet), wasVisible: false };
});

const clawd = new Clawd();
clawd.root.visible = false;
scene.add(clawd.root);
let clawdSide: HandLabel | null = null;
let clawdRise = 0; // 0 = fully below the stage, 1 = fully risen
let clawdSettledX = 0;

// Brain-driven gaze bias: set by an incoming action, decays back to 0.
let brainGaze = 0;
let brainGazeWeight = 0;

function viewSize(z = 0) {
  const dist = camera.position.z - z;
  const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  return { w: h * camera.aspect, h };
}

// Push puppets back in depth so the proscenium frame (at z ≈ 0.3) renders
// in front of them. Scale compensates for perspective shrinkage.
const PUPPET_Z = -1.5;
const PUPPET_DEPTH_SCALE =
  (camera.position.z - PUPPET_Z) / camera.position.z;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const view = viewSize(0);
  theater.layout(view.w, view.h);
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
    const { w, h } = viewSize(PUPPET_Z);
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
  const visible = s.visible > 0.02;
  p.visible = visible;
  p.position.set(s.x, s.y, PUPPET_Z);
  p.rotation.z = s.roll;
  p.scale.setScalar(0.9 * PUPPET_DEPTH_SCALE * Math.max(0.3, s.visible));
  spec.puppet.setOpen(s.open);
  spec.puppet.setGaze(s.gazeX, s.gazeY);
  if (visible && !spec.wasVisible) spec.ragdoll.reset();
  spec.wasVisible = visible;
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

hands.onResults((results: Results) => {
  handData.Left = null;
  handData.Right = null;
  if (!results.multiHandLandmarks || !results.multiHandedness) return;
  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const lm = results.multiHandLandmarks[i];
    const world = results.multiHandWorldLandmarks?.[i];
    const label = results.multiHandedness[i]?.label as "Left" | "Right" | undefined;
    if (lm && world && label && !handData[label]) {
      handData[label] = { lm, world };
    }
  }
});

let welcomeSpoken = false;
function announceWelcome() {
  const synth = window.speechSynthesis;
  if (!synth || welcomeSpoken) return;

  const speak = () => {
    if (welcomeSpoken) return;
    const utter = new SpeechSynthesisUtterance(
      "Welcome to the Virtual Puppet Theater. Turn on your webcam and use your right hand to bring your puppet to life.",
    );
    utter.rate = 1.0;
    utter.pitch = 1.05;
    utter.volume = 1.0;
    const voices = synth.getVoices();
    const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
    const MALE_NAMES = /daniel|alex|fred|rishi|oliver|george|aaron|arthur|male|david|mark|james|\+m[1-7]\b/i;
    const preferred =
      en.find((v) => MALE_NAMES.test(v.name)) ||
      en.find((v) => v.name.toLowerCase().includes("google")) ||
      en[0];
    if (preferred) utter.voice = preferred;
    utter.onstart = () => { welcomeSpoken = true; };
    synth.cancel();
    synth.speak(utter);
  };

  const tryNow = () => {
    if (synth.getVoices().length > 0) speak();
    else synth.addEventListener("voiceschanged", speak, { once: true });
  };

  tryNow();

  // Autoplay policy: if the utterance never started within a moment (no prior
  // user gesture), arm one-shot gesture listeners to kick it off.
  setTimeout(() => {
    if (welcomeSpoken) return;
    const onGesture = () => {
      if (welcomeSpoken) return;
      speak();
    };
    const opts = { once: true, capture: true } as const;
    window.addEventListener("pointerdown", onGesture, opts);
    window.addEventListener("keydown", onGesture, opts);
    window.addEventListener("touchstart", onGesture, opts);
  }, 600);
}

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
    setTimeout(() => {
      loader.remove();
      announceWelcome();
    }, 500);
    return;
  }
  requestAnimationFrame(tickLoader);
}
tickLoader();

function updateClawd(dt: number) {
  const leftPresent = handData.Left !== null;
  const rightPresent = handData.Right !== null;
  const count = (leftPresent ? 1 : 0) + (rightPresent ? 1 : 0);
  // Clawd stays on stage unless the user brings up a second hand — then he
  // cedes the stage so both human puppets have room.
  const riseTarget = count >= 2 ? 0 : 1;

  // Exponential ease toward target (slightly faster on descent).
  const tau = riseTarget > clawdRise ? 0.28 : 0.18;
  clawdRise += (riseTarget - clawdRise) * (1 - Math.exp(-dt / tau));

  // Fully hidden when settled below — stop animating, free the slot.
  if (riseTarget === 0 && clawdRise < 0.005) {
    clawd.root.visible = false;
    clawdSide = null;
    return;
  }
  clawd.root.visible = true;

  const { w, h } = viewSize(PUPPET_Z);
  const settledY = -h * 0.1;
  const belowY = -h / 2 - 2.8; // offstage below the apron

  // Pick Clawd's resting side based on where the human puppet is (if any).
  // With no hands up, default to stage-left so he has a consistent home.
  if (count === 1) {
    clawdSide = leftPresent ? "Right" : "Left";
    const activeIdx = puppets.findIndex(
      (p) => (p.hand === "Left" && leftPresent) || (p.hand === "Right" && rightPresent),
    );
    const active = smoothed[activeIdx]!;
    const sideSign = Math.sign(active.x) || (clawdSide === "Right" ? 1 : -1);
    const targetX = -sideSign * w * 0.22;
    clawdSettledX += (targetX - clawdSettledX) * (1 - Math.exp(-dt / 0.25));
  } else if (count === 0) {
    if (clawdSide === null) clawdSide = "Right";
    const targetX = (clawdSide === "Right" ? -1 : 1) * w * 0.22;
    clawdSettledX += (targetX - clawdSettledX) * (1 - Math.exp(-dt / 0.25));
  }

  clawd.root.position.x = clawdSettledX;
  clawd.root.position.y = belowY + (settledY - belowY) * clawdRise;
  clawd.root.position.z = PUPPET_Z;
  clawd.root.scale.setScalar(0.65 * PUPPET_DEPTH_SCALE);

  // Glance toward the currently visible puppet (if any), blended with
  // whatever gaze the Brain most recently requested.
  const activeIdx = puppets.findIndex((p) => p.puppet.root.visible);
  const puppetGlance =
    activeIdx >= 0
      ? Math.max(-1, Math.min(1, (smoothed[activeIdx]!.x - clawd.root.position.x) * 0.3))
      : 0;
  brainGazeWeight *= Math.exp(-dt / 1.2);
  const glance = brainGaze * brainGazeWeight + puppetGlance * (1 - brainGazeWeight);
  clawd.update(dt, glance);
}

let cameraReady = false;
let sending = false;
let lastFrameTime = performance.now();
async function frame() {
  if (cameraReady && !sending && video.readyState >= 2) {
    sending = true;
    hands.send({ image: video }).finally(() => {
      sending = false;
    });
  }
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  for (let i = 0; i < puppets.length; i++) updatePuppet(i);
  brain.notifyPuppetVisible(
    puppets[0]!.puppet.root.visible,
    puppets[1]!.puppet.root.visible,
  );
  for (const spec of puppets) {
    if (spec.puppet.root.visible) spec.ragdoll.update(dt);
  }
  updateClawd(dt);
  drawLandmarks();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ─── Clawd voice + brain wiring ─────────────────────────────────────────────

function pickClawdVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const MALE = /daniel|alex|fred|rishi|oliver|george|aaron|arthur|male|david|mark|james|\+m[1-7]\b/i;
  return (
    en.find((v) => /google/i.test(v.name) && MALE.test(v.name)) ||
    en.find((v) => MALE.test(v.name)) ||
    en.find((v) => /google/i.test(v.name)) ||
    en[0] ||
    null
  );
}

// Chrome blocks speechSynthesis.speak() until the page has had a user
// gesture. Queue speech until then and flush on the first click/keypress.
// Chrome also loads the voice list asynchronously — speaking before the
// list is populated yields "synthesis-failed", so gate on that too.
let speechUnlocked = false;
let voicesReady = (window.speechSynthesis?.getVoices().length ?? 0) > 0;
const pendingSpeech: string[] = [];

if (window.speechSynthesis && !voicesReady) {
  // Touching getVoices() kicks Chrome into loading them.
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    voicesReady = (window.speechSynthesis.getVoices().length ?? 0) > 0;
    if (voicesReady && speechUnlocked) flushPendingSpeech();
  });
}

function flushPendingSpeech() {
  const queued = pendingSpeech.splice(0);
  for (const text of queued) speakNow(text);
}

function unlockSpeech() {
  if (speechUnlocked) return;
  speechUnlocked = true;
  setTimeout(() => {
    if (voicesReady) flushPendingSpeech();
  }, 50);
}
window.addEventListener("pointerdown", unlockSpeech, { capture: true });
window.addEventListener("keydown", unlockSpeech, { capture: true });
window.addEventListener("touchstart", unlockSpeech, { capture: true });

// Press "h" for a minimal TTS smoke test — bypasses the queue/gating.
window.addEventListener("keydown", (e) => {
  if (e.key !== "h" && e.key !== "H") return;
  const synth = window.speechSynthesis;
  const voices = synth?.getVoices() ?? [];
  console.log("[tts-test] H pressed", {
    hasSynth: !!synth,
    voiceCount: voices.length,
    voices: voices.map((v) => `${v.name} (${v.lang})`),
    speaking: synth?.speaking,
    pending: synth?.pending,
    paused: synth?.paused,
  });
  if (!synth) return;
  const utter = new SpeechSynthesisUtterance("Hello");
  utter.onstart = () => console.log("[tts-test] onstart");
  utter.onend = () => console.log("[tts-test] onend");
  utter.onerror = (e) => console.warn("[tts-test] error:", (e as SpeechSynthesisErrorEvent).error);
  synth.speak(utter);
  console.log("[tts-test] speak() called");
});

function speakNow(text: string, retry = true) {
  const synth = window.speechSynthesis;
  if (!synth || !text) {
    console.warn("[tts] skip", { hasSynth: !!synth, text });
    return;
  }
  const preState = { speaking: synth.speaking, pending: synth.pending, paused: synth.paused };
  if (synth.speaking || synth.pending) synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.0;
  utter.pitch = 0.9;
  const voice = pickClawdVoice();
  if (voice) utter.voice = voice;
  const voiceInfo = voice
    ? { name: voice.name, lang: voice.lang, localService: voice.localService, default: voice.default }
    : null;
  console.log("[tts] speak", {
    text,
    length: text.length,
    retry,
    rate: utter.rate,
    pitch: utter.pitch,
    voice: voiceInfo,
    voiceCount: synth.getVoices().length,
    preState,
  });
  utter.onstart = () => console.log("[tts] onstart", { text });
  utter.onend = () => console.log("[tts] onend", { text });
  utter.onerror = (e) => {
    const err = (e as SpeechSynthesisErrorEvent).error;
    console.warn("[tts] error:", err, { text, retry });
    if (retry && err === "synthesis-failed") {
      setTimeout(() => speakNow(text, false), 120);
    }
  };
  synth.speak(utter);
}

function speak(text: string) {
  if (!speechUnlocked || !voicesReady) {
    console.log("[tts] queued:", text, { speechUnlocked, voicesReady });
    pendingSpeech.push(text);
    return;
  }
  speakNow(text);
}

const GAZE_TO_BIAS: Record<Gaze, number> = {
  user: 0,
  away: -0.9,
  up: 0,
  down: 0,
};

function applyAction(action: Action) {
  if (action.gaze) {
    brainGaze = GAZE_TO_BIAS[action.gaze];
    brainGazeWeight = 1;
  }
  if (action.emotion) clawd.setEmotion(action.emotion);
  if (action.gesture) clawd.playGesture(action.gesture);
  if (action.say) speak(action.say);
}

const wsProto = location.protocol === "https:" ? "wss" : "ws";
const brain = new Brain(`${wsProto}://${location.host}/ws`, {
  onAction: applyAction,
  onCancelSpeech: () => window.speechSynthesis?.cancel(),
});
brain.start();

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
  brain.markReady();
})();
