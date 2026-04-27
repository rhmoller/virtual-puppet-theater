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
import { UserPuppetController, type HandData } from "./user-controller";
import { AiPuppetController } from "./ai-controller";
import { SceneController } from "./scene-controller";
import { SceneState } from "./scene-state";
import type {
  AnchorName,
  PuppetId,
  SlotName,
  UserGesture,
  UserPose,
  UserEnergy,
} from "../server/protocol.ts";

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

// Debug-mode cycle, driven by the `D` key. Each press advances:
//   normal → camera → camera-markers → camera-puppet → normal …
// CSS rules in index.html key off body[data-debug] for visibility;
// JS side only handles the two pieces CSS can't reach: the THREE
// scene background (transparent vs. opaque) and the theater rig
// visibility (hidden in any camera-* mode).
const DEBUG_MODES = ["normal", "camera", "camera-markers", "camera-puppet"] as const;
type DebugMode = (typeof DEBUG_MODES)[number];
let debugIdx = 0;
function setDebugMode(mode: DebugMode) {
  if (mode === "normal") delete document.body.dataset.debug;
  else document.body.dataset.debug = mode;
  scene.background = mode === "normal" ? SCENE_BG : null;
  theater.setVisible(mode === "normal");
  // Demo-prep: don't run the user↔AI loop in any camera mode.
  // STT stops, outbound user events are dropped, ongoing TTS is
  // silenced. Idle-escalations still cost LLM calls server-side
  // but their actions are dropped on the client — acceptable.
  if (mode === "normal") brain?.resume();
  else brain?.pause();
}
window.addEventListener("keydown", (e) => {
  if (e.key === "d" || e.key === "D") {
    debugIdx = (debugIdx + 1) % DEBUG_MODES.length;
    setDebugMode(DEBUG_MODES[debugIdx]!);
  }
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

// Single user-controlled puppet. MediaPipe is configured for one hand;
// whichever hand the user shows drives this puppet.
const userController = new UserPuppetController(
  new Puppet(PUPPET_THEMES.warm),
  PUPPET_Z,
  PUPPET_DEPTH_SCALE,
);
userController.model.root.visible = false;
scene.add(userController.model.root);

const stagePuppet = new StagePuppet();
stagePuppet.root.visible = false;
scene.add(stagePuppet.root);

const aiController = new AiPuppetController(stagePuppet, {
  puppetZ: PUPPET_Z,
  depthScale: PUPPET_DEPTH_SCALE,
  speak,
});

// Scene state + controller for cosmetics and scene props directed by
// the LLM. The slot and anchor resolvers map PuppetId/SlotName ↔ the
// actual THREE.Group attach points exposed by the rigs and theater.
const sceneState = new SceneState();
const sceneController = new SceneController(
  sceneState,
  (puppet: PuppetId, slot: SlotName) => {
    if (puppet === "ai") return stagePuppet.attach(slot);
    return userController.model.attach(slot);
  },
  (anchor: AnchorName) => theater.anchor(anchor),
  (puppet, channel, color) => {
    const model = puppet === "ai" ? stagePuppet : userController.model;
    model.recolor(channel, color);
  },
);

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

let handData: HandData | null = null;

const hands = new window.Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.5,
});

let lastTracking = false;
hands.onResults((results: Results) => {
  handData = null;
  if (results.multiHandLandmarks && results.multiHandedness) {
    const lm = results.multiHandLandmarks[0];
    const world = results.multiHandWorldLandmarks?.[0];
    const label = results.multiHandedness[0]?.label as "Left" | "Right" | undefined;
    if (lm && world && label) handData = { lm, world, hand: label };
  }
  const tracking = !!handData;
  if (tracking !== lastTracking) {
    lastTracking = tracking;
    hud.setCamera(
      tracking ? "ok" : "warn",
      tracking ? "Tracking hand" : "Camera ready — show a hand",
    );
  }
});

// Diff vs. last sent so we only emit a `signal` event on real change.
const ENERGY_DEBOUNCE_S = 0.5;
let lastSentPose: UserPose | null = null;
let lastSentEnergy: UserEnergy | null = null;
let pendingEnergy: UserEnergy | null = null;
let pendingEnergyAccum = 0;
let lastFlushTime = performance.now();
function flushSignal() {
  const gestures: UserGesture[] = userController.drainGestures();
  const pose = userController.visible ? userController.pose : null;
  const energy = userController.visible ? userController.energy : null;

  const nowFlush = performance.now();
  const flushDt = Math.min(0.1, (nowFlush - lastFlushTime) / 1000);
  lastFlushTime = nowFlush;

  // Debounce energy: only send a transition once it's been stable.
  let energyToSend: UserEnergy | undefined;
  if (energy === lastSentEnergy) {
    pendingEnergy = null;
    pendingEnergyAccum = 0;
  } else if (energy !== null) {
    if (energy === pendingEnergy) {
      pendingEnergyAccum += flushDt;
      if (pendingEnergyAccum >= ENERGY_DEBOUNCE_S) {
        energyToSend = energy;
        pendingEnergy = null;
        pendingEnergyAccum = 0;
      }
    } else {
      pendingEnergy = energy;
      pendingEnergyAccum = 0;
    }
  }

  const delta: { gestures?: UserGesture[]; pose?: UserPose; energy?: UserEnergy } = {};
  if (gestures.length > 0) delta.gestures = gestures;
  if (pose !== null && pose !== lastSentPose) delta.pose = pose;
  if (energyToSend !== undefined) delta.energy = energyToSend;

  if (
    delta.gestures === undefined &&
    delta.pose === undefined &&
    delta.energy === undefined
  ) {
    return;
  }
  // Brain is constructed only after the landing resolves (we need the
  // chosen brain size for the WS URL). Frames before that just discard.
  if (!brain) return;
  brain.sendSignal(delta);
  if (delta.pose !== undefined) lastSentPose = delta.pose;
  if (delta.energy !== undefined) lastSentEnergy = delta.energy;
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

  const view = viewSize(PUPPET_Z);
  userController.update(dt, handData, view);
  brain?.notifyPuppetVisible(userController.visible);
  aiController.update(
    dt,
    view,
    userController.visible ? { visible: true, state: userController.state } : null,
  );
  // Drive cosmetic / scene-prop fade-in/out animations.
  sceneController.update(dt);

  drawLandmarks(handData);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Body-language signals are diff-based — sending them at 60Hz wastes
// allocations and wire bytes for the rare-change shape they have.
// 4Hz matches the puppet_state flush cadence and is plenty for the
// LLM's reaction-time needs (next turn is 1–3s away anyway).
setInterval(flushSignal, 250);

// Brain wiring — TTS, emotion/gesture dispatch, WebSocket.

installSpeechUnlock();
setSpeakingCallback((on) => {
  stagePuppet.setSpeaking(on);
  hud.setAi(on ? "speaking" : "idle");
});

// If the user picks a voice on the landing page, suppress the server's
// pick — their explicit choice should win.
let userVoiceLocked = false;

// Brain is constructed only after the landing resolves so the chosen
// brain size can be encoded in the WS URL (the server picks the LLM
// model at session-construction time).
let brain: Brain | null = null;

// Landing page owns the camera/mic/TTS preflight. Once the user clicks
// Start, we hand the already-acquired stream to the theater pipeline so
// no second permission prompt is needed.
showLanding().then(async ({ stream, userPickedVoiceURI, brainSize }) => {
  if (userPickedVoiceURI) {
    userVoiceLocked = true;
    setSelectedVoice(userPickedVoiceURI);
  }

  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const b = new Brain(`${wsProto}://${location.host}/ws?brain=${brainSize}`, {
    onAction: (action) => {
      // Embodiment fields (say/emotion/gaze/gesture) go to the AI puppet
      // controller; scene-direction effects go to the SceneController.
      aiController.applyAction(action);
      if (action.effects && action.effects.length > 0) {
        sceneController.applyEffects(action.effects);
        // Each request_* effect kicks off a parallel asset-design call
        // — show a "dreaming" chip in the HUD until the matching
        // asset_ready arrives.
        for (const e of action.effects) {
          if (e.op === "request_cosmetic" || e.op === "request_prop") {
            hud.startDreaming();
          }
        }
      }
    },
    onCancelSpeech: cancelSpeech,
    onAssetReady: (request_id, asset_name, spec) => {
      sceneController.registerGenerated(request_id, asset_name, spec);
      hud.endDreaming();
    },
    onVoicePick: (uri) => {
      if (userVoiceLocked) return;
      setSelectedVoice(uri);
    },
    onConnection: (state) => hud.setConnection(state),
    onMicState: (state) => {
      if (state === "listening") {
        hud.setMic("ok", "Microphone listening");
        hud.setStt("listening");
      } else if (state === "denied") {
        hud.setMic("err", "Microphone blocked — enable it in your browser");
        hud.setStt("denied", "STT blocked — enable mic");
      } else if (state === "unsupported") {
        hud.setMic("err", "Speech input needs Chrome or Edge");
        hud.setStt("unsupported", "STT unsupported");
      } else {
        hud.setMic("err", "Microphone error");
        hud.setStt("error");
      }
    },
    onTranscript: (text, final) => {
      hud.setStt(final ? "listening" : "hearing");
      hud.setTranscript(text, final);
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
  brain = b;

  b.start();
  onVoicesReady(() => {
    const voices = snapshotVoices();
    if (voices && voices.length > 0) b.sendVoiceList(voices);
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
  b.markReady();
});
