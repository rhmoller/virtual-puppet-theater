// One renderer for any AssetSpec — pre-fab catalog item or LLM-designed
// asset. Maps each part's primitive shape to a THREE BufferGeometry,
// applies color + transform, and stuffs them into a fresh THREE.Group.
//
// Why parametric primitives instead of LLM-emitted code: the spec format
// is a tight, validated JSON schema (see ASSET_SPEC_JSON_SCHEMA in
// server/protocol.ts). The LLM can't drop arbitrary code into the scene;
// it can only describe a composition of safe shapes. Expressivity ceiling
// is exactly where kid-grade props live (a banana hat is one yellow
// torus + one brown cone).

import * as THREE from "three";
import type { AssetSpec, AssetShape } from "../../server/protocol.ts";

// Geometry instances are reused across all assets — they're stateless
// and immutable once constructed. Each shape uses a unit-sized variant;
// per-part scale in the spec produces the actual on-screen size.
const GEOMETRIES: Record<AssetShape, THREE.BufferGeometry> = {
  sphere: new THREE.SphereGeometry(0.5, 18, 14),
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 18),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
  torus: new THREE.TorusGeometry(0.4, 0.15, 12, 24),
};

export function renderSpec(spec: AssetSpec): THREE.Group {
  const group = new THREE.Group();
  for (const part of spec.parts) {
    const geom = GEOMETRIES[part.shape];
    if (!geom) continue;
    const mat = new THREE.MeshStandardMaterial({
      color: parseColor(part.color),
      roughness: 0.7,
    });
    const mesh = new THREE.Mesh(geom, mat);
    // Coerce arrays to length-3 with sane defaults — the wire schema
    // can't enforce tuple length on Anthropic structured output.
    const [px, py, pz] = vec3(part.position, 0);
    const [rx, ry, rz] = vec3(part.rotation, 0);
    const [sx, sy, sz] = vec3(part.scale, 1);
    mesh.position.set(px, py, pz);
    mesh.rotation.set(rx, ry, rz);
    mesh.scale.set(sx, sy, sz);
    group.add(mesh);
  }
  return group;
}

const FALLBACK_COLOR = 0xcccccc;

// Color in the wire spec can be a hex string ("#ff8800" or "ff8800" —
// what the LLM emits) or a packed integer (0xff8800 — convenient for
// hand-authored catalog literals). Returns a 24-bit integer.
function parseColor(c: number | string | undefined | null): number {
  if (typeof c === "number" && Number.isFinite(c) && c > 0) {
    return c & 0xffffff;
  }
  if (typeof c === "string") {
    const hex = c.startsWith("#") ? c.slice(1) : c;
    // Accept 3-digit shorthand ("f80" → "ff8800") for completeness.
    const expanded =
      hex.length === 3
        ? hex
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : hex;
    if (expanded.length !== 6) return FALLBACK_COLOR;
    const n = parseInt(expanded, 16);
    return Number.isFinite(n) ? n & 0xffffff : FALLBACK_COLOR;
  }
  return FALLBACK_COLOR;
}

function vec3(
  arr: ReadonlyArray<number> | undefined,
  fallback: number,
): [number, number, number] {
  const a = arr && arr.length > 0 ? arr : [fallback, fallback, fallback];
  const x = typeof a[0] === "number" ? a[0] : fallback;
  const y = typeof a[1] === "number" ? a[1] : fallback;
  const z = typeof a[2] === "number" ? a[2] : fallback;
  return [x, y, z];
}
