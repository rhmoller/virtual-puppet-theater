import * as THREE from "three";
import type { Hands as HandsType, Results } from "@mediapipe/hands";
import { StagePuppet } from "./puppet-stage";
import { Puppet, PUPPET_THEMES } from "./puppet";
import { Theater } from "./theater";
import { Brain } from "./brain";
import { drawLandmarks } from "./landmarks";
import {
  speak,
  cancelSpeech,
  installSpeechUnlock,
  onVoicesReady,
  snapshotVoices,
  setSelectedVoice,
  setSpeakingCallback,
} from "./speech";
import { showLanding } from "./landing";
import { Hud } from "./hud";
import { UserPuppetController, type HandData, type HandLabel } from "./user-controller";
import { AiPuppetController } from "./ai-controller";

declare global {
  interface Window {
    Hands: new (config: { locateFile: (file: string) => string }) => HandsType;
  }
}

const video = document.getElementById("video") as HTMLVideoElement;
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const hud = new Hud();

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

// Push puppets back in depth so the proscenium frame (at z ≈ 0.3) renders
// in front of them. Scale compensates for perspective shrinkage.
const PUPPET_Z = -1.5;
const PUPPET_DEPTH_SCALE = (camera.position.z - PUPPET_Z) / camera.position.z;

function viewSize(z = 0) {
  const dist = camera.position.z - z;
  const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  return { w: h * camera.aspect, h };
}

// Two user-controlled puppets, one per hand, each driven by its own
// controller. Themes are explicit so left/right have distinct identity.
const userControllers: UserPuppetController[] = [
  new UserPuppetController(new Puppet(PUPPET_THEMES.warm), "Left", PUPPET_Z, PUPPET_DEPTH_SCALE),
  new UserPuppetController(new Puppet(PUPPET_THEMES.cool), "Right", PUPPET_Z, PUPPET_DEPTH_SCALE),
];
for (const c of userControllers) {
  c.model.root.visible = false;
  scene.add(c.model.root);
}

const stagePuppet = new StagePuppet();
stagePuppet.root.visible = false;
scene.add(stagePuppet.root);

const aiController = new AiPuppetController(stagePuppet, {
  puppetZ: PUPPET_Z,
  depthScale: PUPPET_DEPTH_SCALE,
  speak,
});

// theater.layout rebuilds ~100 merged bead geometries + curtains — too
// expensive to run on every drag-resize event. Coalesce with a 120ms
// trailing call so only the settled size pays the rebuild cost.
let theaterLayoutTimer: ReturnType<typeof setTimeout> | null = null;
function applyTheaterLayout() {
  theaterLayoutTimer = null;
  const view = viewSize(0);
  theater.layout(view.w, view.h);
}
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (theaterLayoutTimer !== null) clearTimeout(theaterLayoutTimer);
  theaterLayoutTimer = setTimeout(applyTheaterLayout, 120);
}
window.addEventListener("resize", resize);
resize();
// Fire the initial layout synchronously — the first rendered frame must
// already have a stage, not wait 120ms for the trailing call.
if (theaterLayoutTimer !== null) {
  clearTimeout(theaterLayoutTimer);
  applyTheaterLayout();
}

const handData: Record<HandLabel, HandData | null> = { Left: null, Right: null };

const hands = new window.Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.5,
});

let lastTracking = false;
hands.onResults((results: Results) => {
  handData.Left = null;
  handData.Right = null;
  if (results.multiHandLandmarks && results.multiHandedness) {
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const lm = results.multiHandLandmarks[i];
      const world = results.multiHandWorldLandmarks?.[i];
      const label = results.multiHandedness[i]?.label as "Left" | "Right" | undefined;
      if (lm && world && label && !handData[label]) {
        handData[label] = { lm, world };
      }
    }
  }
  const tracking = !!handData.Left || !!handData.Right;
  if (tracking !== lastTracking) {
    lastTracking = tracking;
    hud.setCamera(
      tracking ? "ok" : "warn",
      tracking ? "Tracking hand" : "Camera ready — show a hand",
    );
  }
});

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

  const view = viewSize(PUPPET_Z);
  for (const c of userControllers) c.update(dt, handData[c.hand], view);
  brain.notifyPuppetVisible(userControllers[0]!.visible, userControllers[1]!.visible);
  aiController.update(
    dt,
    view,
    userControllers.map((c) => ({ visible: c.visible, state: c.state, hand: c.hand })),
  );

  drawLandmarks(handData);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Brain wiring — TTS, emotion/gesture dispatch, WebSocket.

installSpeechUnlock();
setSpeakingCallback((on) => {
  stagePuppet.setSpeaking(on);
  hud.setAi(on ? "speaking" : "idle");
});

// If the user picks a voice on the landing page, suppress the server's
// pick — their explicit choice should win.
let userVoiceLocked = false;

const wsProto = location.protocol === "https:" ? "wss" : "ws";
const brain = new Brain(`${wsProto}://${location.host}/ws`, {
  onAction: (action) => aiController.applyAction(action),
  onCancelSpeech: cancelSpeech,
  onVoicePick: (uri) => {
    if (userVoiceLocked) return;
    setSelectedVoice(uri);
  },
  onConnection: (state) => hud.setConnection(state),
  onMicState: (state) => {
    if (state === "listening") hud.setMic("ok", "Microphone listening");
    else if (state === "denied") hud.setMic("err", "Microphone blocked — enable it in your browser");
    else if (state === "unsupported") hud.setMic("err", "Speech input needs Chrome or Edge");
    else hud.setMic("err", "Microphone error");
  },
  onAiThinking: (thinking) => {
    if (thinking) hud.setAi("thinking");
    // 'speaking' / 'idle' are driven by the TTS callback above.
  },
  onServerError: (msg) => {
    if (/rate|limit|budget/i.test(msg)) {
      hud.toast("AI is taking a quick break — try again in a moment.");
    } else {
      hud.toast("AI hiccup — try again.");
    }
  },
});

// Landing page owns the camera/mic/TTS preflight. Once the user clicks
// Start, we hand the already-acquired stream to the theater pipeline so
// no second permission prompt is needed.
showLanding().then(async ({ stream, userPickedVoiceURI }) => {
  if (userPickedVoiceURI) {
    userVoiceLocked = true;
    setSelectedVoice(userPickedVoiceURI);
  }

  brain.start();
  onVoicesReady(() => {
    const voices = snapshotVoices();
    if (voices && voices.length > 0) brain.sendVoiceList(voices);
  });

  if (stream) {
    video.srcObject = stream;
    try {
      await video.play();
      await hands.initialize();
      cameraReady = true;
      hud.setCamera("warn", "Camera ready — show a hand");
    } catch (err) {
      console.warn("Camera/MediaPipe init failed:", err);
      hud.setCamera("err", "Camera init failed");
    }
  } else {
    hud.setCamera("err", "Camera unavailable");
  }
  brain.markReady();
});
