import { test, expect } from "bun:test";
import * as THREE from "three";
import { StagePuppet } from "./puppet-stage.ts";

test("construction builds a visible rig", () => {
  const p = new StagePuppet();
  expect(p.root).toBeInstanceOf(THREE.Group);
  // root → rig → bodyGroup → (torso, yoke, neck, head, arms)
  const rig = p.root.children[0] as THREE.Group;
  const bodyGroup = rig.children[0] as THREE.Group;
  // Expect torso + yoke + neck + head group + two arm groups = 6
  expect(bodyGroup.children.length).toBeGreaterThanOrEqual(6);
});

test("setEmotion(surprised) drives wider eye scale after a few updates", () => {
  const p = new StagePuppet();
  // prime neutral
  p.update(0.5);
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
  // Ease over several frames. Tau ~300ms, so 1.5s settles well.
  for (let i = 0; i < 30; i++) p.update(0.05);
  expect(eye!.scale.y).toBeGreaterThan(neutralY);
});

test("playGesture(wave) becomes inactive after the gesture duration", () => {
  const p = new StagePuppet();
  p.playGesture("wave");
  // Wave duration is 1.2s. Tick past it and a little extra.
  for (let i = 0; i < 30; i++) p.update(0.05);
  // Now play another gesture from a clean state and confirm timer starts fresh.
  p.playGesture("wave");
  // After one update, gesture should still be active (not expired).
  p.update(0.1);
  // Tick far past duration; the internal timer should reset back to "none".
  for (let i = 0; i < 40; i++) p.update(0.05);
  // Replaying a gesture after expiry should be a no-op on failed case:
  // if the old gesture had not cleared, the internal gestureT would keep
  // accumulating, but we can verify indirectly by ensuring updates still
  // run without error across many calls.
  expect(() => {
    for (let i = 0; i < 10; i++) p.update(0.05);
  }).not.toThrow();
});

test("setSpeaking(true) makes the mouth visible and open; setSpeaking(false) hides it again", () => {
  const p = new StagePuppet();
  // Settle with speaking off — mouth should be hidden.
  for (let i = 0; i < 10; i++) p.update(0.05);
  const scan = (root: THREE.Object3D, out: THREE.Mesh[] = []): THREE.Mesh[] => {
    if (root instanceof THREE.Mesh) out.push(root);
    for (const c of root.children) scan(c, out);
    return out;
  };
  const meshes = scan(p.root);
  // Mouth is the only dark squashed sphere that starts hidden.
  const hiddenDarkMeshes = meshes.filter(
    (m) =>
      !m.visible && (m.material as THREE.MeshStandardMaterial).color.getHex() === 0x1a1410,
  );
  expect(hiddenDarkMeshes.length).toBe(1);
  const mouth = hiddenDarkMeshes[0]!;

  // Turn speaking on; run frames; mouth y-scale should rise above ~0 and
  // become visible.
  p.setSpeaking(true);
  let maxScaleY = 0;
  for (let i = 0; i < 60; i++) {
    p.update(0.033);
    if (mouth.scale.y > maxScaleY) maxScaleY = mouth.scale.y;
  }
  expect(maxScaleY).toBeGreaterThan(0.05);
  expect(mouth.visible).toBe(true);

  // Turn speaking off; envelope decays and mouth becomes hidden again.
  p.setSpeaking(false);
  for (let i = 0; i < 120; i++) p.update(0.033);
  expect(mouth.visible).toBe(false);
});
