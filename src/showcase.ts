// src/showcase.ts — dev tool to verify the stage puppet's animations in
// isolation. Renders the puppet alone with a side panel to trigger every
// emotion, gaze, gesture, and the speaking toggle. Open at /showcase.html
// in dev.

import * as THREE from "three";
import { StagePuppet } from "./puppet-stage";
import { Puppet, PUPPET_THEMES } from "./puppet";
import type { Emotion, Gaze, Gesture } from "../server/protocol.ts";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 7);

scene.add(new THREE.AmbientLight(0xffffff, 0.3));
const keyLight = new THREE.DirectionalLight(0xfff2d8, 1.4);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x88aaff, 0.5);
fillLight.position.set(-4, -1, 3);
scene.add(fillLight);

// Grid so rotation and Y-bob are easier to read.
const grid = new THREE.GridHelper(8, 8, 0x333333, 0x222222);
grid.position.y = -1.9;
scene.add(grid);

const puppet = new StagePuppet();
scene.add(puppet.root);

// User puppet sits beside the AI puppet for visual QA. It cycles
// through a gentle mouth-open animation so the jaw mechanic is visible
// without hand tracking.
const userPuppet = new Puppet(PUPPET_THEMES.warm);
userPuppet.root.position.set(-3.4, 0, 0);
userPuppet.root.scale.setScalar(0.9);
scene.add(userPuppet.root);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// --- State ---
const EMOTIONS: Emotion[] = ["neutral", "smug", "curious", "excited", "bored", "surprised"];
const GAZES: Gaze[] = ["user", "away", "up", "down"];
const GESTURES: Gesture[] = [
  "none",
  "wave",
  "shrug",
  "lean_in",
  "nod",
  "shake",
  "jump",
  "spin",
  "wiggle",
];

// Matches main.ts's GAZE_TO_BIAS.
const GAZE_TO_BIAS: Record<Gaze, { x: number; y: number }> = {
  user: { x: 0, y: 0 },
  away: { x: -0.9, y: 0 },
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
};

let currentEmotion: Emotion = "neutral";
let currentGaze: Gaze = "user";
let speaking = false;

// --- UI wiring ---
function makeButtons<T extends string>(
  containerId: string,
  labels: readonly T[],
  onClick: (label: T, btn: HTMLButtonElement) => void,
  active?: T,
): Map<T, HTMLButtonElement> {
  const container = document.getElementById(containerId)!;
  const buttons = new Map<T, HTMLButtonElement>();
  for (const label of labels) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", () => onClick(label, btn));
    container.appendChild(btn);
    buttons.set(label, btn);
  }
  if (active) buttons.get(active)?.classList.add("active");
  return buttons;
}

const currentDiv = document.getElementById("current")!;
function refreshStatus() {
  currentDiv.innerHTML =
    `emotion: <b>${currentEmotion}</b><br>` +
    `gaze: <b>${currentGaze}</b><br>` +
    `speaking: <b>${speaking ? "on" : "off"}</b>`;
}

const emotionButtons = makeButtons(
  "emotions",
  EMOTIONS,
  (e, btn) => {
    currentEmotion = e;
    puppet.setEmotion(e);
    emotionButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    refreshStatus();
  },
  currentEmotion,
);

const gazeButtons = makeButtons(
  "gazes",
  GAZES,
  (g, btn) => {
    currentGaze = g;
    gazeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    refreshStatus();
  },
  currentGaze,
);

makeButtons("gestures", GESTURES, (g) => {
  puppet.playGesture(g);
});

const speakingButtons = makeButtons(
  "speaking",
  ["on", "off"] as const,
  (label, btn) => {
    speaking = label === "on";
    puppet.setSpeaking(speaking);
    speakingButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    refreshStatus();
  },
  "off",
);

refreshStatus();

// --- Render loop ---
let lastT = performance.now();
let userT = 0;
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const bias = GAZE_TO_BIAS[currentGaze];
  puppet.setGaze(bias.x, bias.y);
  puppet.update(dt);

  // User puppet: gentle gaze sway + periodic mouth-open so the jaw mechanic is visible.
  userT += dt;
  const open = Math.max(0, Math.sin(userT * 1.6)) * 0.7;
  userPuppet.setOpen(open);
  userPuppet.setGaze(Math.sin(userT * 0.4) * 0.5, Math.sin(userT * 0.3) * 0.3);
  userPuppet.update(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
