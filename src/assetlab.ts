// src/assetlab.ts — dev tool to iterate on prop generation and slot
// attachment without webcam, mic, STT, or TTS in the loop. Pick a
// puppet + slot, type a description, click Generate; the server's
// AssetGenerator returns a spec, which we render at the chosen slot.
// Catalog dropdown mounts hand-authored assets for comparison.
//
// Open at /assetlab.html in dev.

import * as THREE from "three";
import { StagePuppet } from "./puppet-stage";
import { Puppet, PUPPET_THEMES } from "./puppet";
import { renderSpec } from "./assets/render";
import { COSMETIC_NAMES, getCosmetic } from "./assets/catalog";
import type { AssetSpec, SlotName } from "../server/protocol.ts";

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

const grid = new THREE.GridHelper(8, 8, 0x333333, 0x222222);
grid.position.y = -1.9;
scene.add(grid);

// Both puppets exist at the same centered position; the picker toggles
// which one is visible (and so which one receives mounts). Mounted
// assets stay parented to their slot group when hidden, so switching
// back restores the prior mount.
const stagePuppet = new StagePuppet();
stagePuppet.root.position.set(0, 0, -1.0);
stagePuppet.root.scale.setScalar(0.9);
scene.add(stagePuppet.root);

const userPuppet = new Puppet(PUPPET_THEMES.warm);
userPuppet.root.position.set(0, 0, -1.0);
userPuppet.root.scale.setScalar(0.9);
scene.add(userPuppet.root);

// Track currently-mounted assets per (puppet, slot) so we can clear
// before mounting a new one.
type PuppetKind = "stage" | "user";
const mounted = new Map<string, THREE.Group>();
function mountKey(puppet: PuppetKind, slot: SlotName): string {
  return `${puppet}:${slot}`;
}

function getSlotGroup(puppet: PuppetKind, slot: SlotName): THREE.Group {
  return puppet === "stage" ? stagePuppet.attach(slot) : userPuppet.attach(slot);
}

function clearMounted(puppet: PuppetKind, slot: SlotName) {
  const key = mountKey(puppet, slot);
  const existing = mounted.get(key);
  if (!existing) return;
  existing.removeFromParent();
  existing.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose?.();
      const m = obj.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
      else m?.dispose?.();
    }
  });
  mounted.delete(key);
}

function mountSpec(puppet: PuppetKind, slot: SlotName, spec: AssetSpec) {
  clearMounted(puppet, slot);
  const slotGroup = getSlotGroup(puppet, slot);
  const group = renderSpec(spec);
  slotGroup.add(group);
  mounted.set(mountKey(puppet, slot), group);
}

// --- UI wiring ---

const puppetSelect = document.getElementById("puppet-kind") as HTMLSelectElement;
const slotSelect = document.getElementById("slot") as HTMLSelectElement;
const descriptionInput = document.getElementById("description") as HTMLInputElement;
const genButton = document.getElementById("gen") as HTMLButtonElement;
const clearButton = document.getElementById("clear") as HTMLButtonElement;
const catalogSelect = document.getElementById("catalog") as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const specEl = document.getElementById("spec") as HTMLPreElement;

for (const name of COSMETIC_NAMES) {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  catalogSelect.appendChild(opt);
}

function applyPuppetVisibility() {
  const kind = puppetSelect.value as PuppetKind;
  stagePuppet.root.visible = kind === "stage";
  userPuppet.root.visible = kind === "user";
}
applyPuppetVisibility();
puppetSelect.addEventListener("change", applyPuppetVisibility);

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", isError);
}

function showSpec(spec: AssetSpec) {
  specEl.hidden = false;
  specEl.textContent = JSON.stringify(spec, null, 2);
}

function currentMount(): { puppet: PuppetKind; slot: SlotName } {
  return {
    puppet: puppetSelect.value as PuppetKind,
    slot: slotSelect.value as SlotName,
  };
}

genButton.addEventListener("click", async () => {
  const description = descriptionInput.value.trim();
  if (!description) {
    setStatus("type a description first", true);
    return;
  }
  const { puppet, slot } = currentMount();
  genButton.disabled = true;
  setStatus(`generating "${description}"…`);
  try {
    const res = await fetch("/assetgen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description,
        mountKind: "cosmetic",
        slotOrAnchor: slot,
      }),
    });
    if (!res.ok) {
      setStatus(`server: ${res.status} ${await res.text()}`, true);
      return;
    }
    const data = (await res.json()) as { spec: AssetSpec };
    mountSpec(puppet, slot, data.spec);
    showSpec(data.spec);
    setStatus(`mounted on ${puppet}.${slot} (${data.spec.parts.length} parts)`);
  } catch (err) {
    setStatus(`error: ${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    genButton.disabled = false;
  }
});

clearButton.addEventListener("click", () => {
  const { puppet, slot } = currentMount();
  clearMounted(puppet, slot);
  specEl.hidden = true;
  setStatus(`cleared ${puppet}.${slot}`);
});

catalogSelect.addEventListener("change", () => {
  const name = catalogSelect.value;
  if (!name) return;
  const spec = getCosmetic(name);
  if (!spec) {
    setStatus(`catalog: no item "${name}"`, true);
    return;
  }
  const { puppet, slot } = currentMount();
  mountSpec(puppet, slot, spec);
  showSpec(spec);
  setStatus(`mounted catalog "${name}" on ${puppet}.${slot}`);
});

descriptionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") genButton.click();
});

// --- Render loop ---

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

let lastT = performance.now();
let userT = 0;
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  // Idle animation runs for the visible puppet only — the hidden one
  // doesn't need to advance its time. Both spin slowly on Y so you can
  // inspect a mounted asset from every angle without orbit controls.
  if (stagePuppet.root.visible) {
    stagePuppet.root.rotation.y += dt * 0.4;
    stagePuppet.setGaze(0, 0);
    stagePuppet.update(dt);
  }
  if (userPuppet.root.visible) {
    userPuppet.root.rotation.y += dt * 0.4;
    userT += dt;
    userPuppet.setOpen(Math.max(0, Math.sin(userT * 1.6)) * 0.4);
    userPuppet.setGaze(Math.sin(userT * 0.4) * 0.3, 0);
    userPuppet.update(dt);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
