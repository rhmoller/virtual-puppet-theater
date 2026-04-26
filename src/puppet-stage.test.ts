import { test, expect } from "bun:test";
import * as THREE from "three";
import { StagePuppet } from "./puppet-stage.ts";

test("construction builds a visible rig with mesh children", () => {
  const p = new StagePuppet();
  expect(p.root).toBeInstanceOf(THREE.Group);
  // Sanity: traversal finds at least one Mesh somewhere under root.
  let meshCount = 0;
  p.root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) meshCount++;
  });
  expect(meshCount).toBeGreaterThan(5);
});

test("setEmotion(surprised) drives wider eye scale after a few updates", () => {
  const p = new StagePuppet();
  // Prime neutral so eased params settle.
  for (let i = 0; i < 10; i++) p.update(0.05);
  // Find an eye-white sphere — first match in a depth-first search.
  const findEye = (root: THREE.Object3D): THREE.Mesh | null => {
    if (root instanceof THREE.Mesh && root.geometry instanceof THREE.SphereGeometry) {
      const mat = root.material as THREE.MeshStandardMaterial;
      if (mat.color.getHex() === 0xf5f1e8) return root;
    }
    for (const c of root.children) {
      const found = findEye(c);
      if (found) return found;
    }
    return null;
  };
  const eye = findEye(p.root);
  expect(eye).not.toBeNull();
  const neutralY = eye!.scale.y;
  p.setEmotion("surprised");
  // Tau ~300ms; settle well past it. Track the peak eye scale across
  // the period so an unlucky blink at the final tick can't fail the
  // assertion.
  let maxEyeY = 0;
  for (let i = 0; i < 40; i++) {
    p.update(0.05);
    if (eye!.scale.y > maxEyeY) maxEyeY = eye!.scale.y;
  }
  expect(maxEyeY).toBeGreaterThan(neutralY * 1.2);
});

test("playGesture(wave) ticks through its duration without errors", () => {
  const p = new StagePuppet();
  p.playGesture("wave");
  for (let i = 0; i < 30; i++) p.update(0.05);
  // Replay from clean state.
  p.playGesture("wave");
  p.update(0.1);
  for (let i = 0; i < 40; i++) p.update(0.05);
  expect(() => {
    for (let i = 0; i < 10; i++) p.update(0.05);
  }).not.toThrow();
});

test("setSpeaking(true) opens the jaw; setSpeaking(false) closes it", () => {
  const p = new StagePuppet();
  // Settle with speaking off — jaw should be at rest (rotation ~0).
  for (let i = 0; i < 10; i++) p.update(0.05);
  // The lowerJaw is a protected field on Puppet; reach it via property
  // access for the test (cast through unknown to bypass visibility).
  const lowerJaw = (p as unknown as { lowerJaw: THREE.Group }).lowerJaw;
  expect(lowerJaw).toBeDefined();
  expect(Math.abs(lowerJaw.rotation.x)).toBeLessThan(0.1);

  // Turn speaking on; envelope ramps up with a 4Hz pulse, so a peak
  // open should appear within ~250ms.
  p.setSpeaking(true);
  let maxOpen = 0;
  for (let i = 0; i < 60; i++) {
    p.update(0.033);
    if (lowerJaw.rotation.x > maxOpen) maxOpen = lowerJaw.rotation.x;
  }
  expect(maxOpen).toBeGreaterThan(0.1);

  // Turn off; envelope decays. Give it time to settle back near 0.
  p.setSpeaking(false);
  for (let i = 0; i < 120; i++) p.update(0.033);
  expect(Math.abs(lowerJaw.rotation.x)).toBeLessThan(0.05);
});
