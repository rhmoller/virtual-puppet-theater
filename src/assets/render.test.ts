import { test, expect } from "bun:test";
import * as THREE from "three";
import { renderSpec } from "./render";
import type { AssetSpec } from "../../server/protocol";

test("renderSpec emits one mesh per part with correct shape ordering", () => {
  const spec: AssetSpec = {
    parts: [
      { shape: "sphere", color: 0xff0000, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { shape: "cone", color: 0x00ff00, position: [0, 1, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
      { shape: "torus", color: 0x0000ff, position: [0, -1, 0], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 1] },
    ],
  };
  const group = renderSpec(spec);
  expect(group.children.length).toBe(3);
  expect((group.children[0] as THREE.Mesh).geometry.type).toBe("SphereGeometry");
  expect((group.children[1] as THREE.Mesh).geometry.type).toBe("ConeGeometry");
  expect((group.children[2] as THREE.Mesh).geometry.type).toBe("TorusGeometry");
});

test("renderSpec applies color, position, scale per part", () => {
  const spec: AssetSpec = {
    parts: [
      {
        shape: "box",
        color: 0xfedcba,
        position: [1, 2, 3],
        rotation: [0, 0, 0],
        scale: [2, 3, 4],
      },
    ],
  };
  const group = renderSpec(spec);
  expect(group.children.length).toBe(1);
  const mesh = group.children[0] as THREE.Mesh;
  expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xfedcba);
  expect(mesh.position.x).toBe(1);
  expect(mesh.position.y).toBe(2);
  expect(mesh.position.z).toBe(3);
  expect(mesh.scale.x).toBe(2);
  expect(mesh.scale.y).toBe(3);
  expect(mesh.scale.z).toBe(4);
});

test("renderSpec handles an empty parts array", () => {
  const group = renderSpec({ parts: [] });
  expect(group.children.length).toBe(0);
});
