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
//
// Convention for "unit scale": each primitive's bounding box fits within
// roughly ±0.5 on its main axes (with a few exceptions for thin axes
// like torus tube depth). The asset-generator prompt documents per-shape
// extents so the LLM can compose contiguous shapes by extent math.
const GEOMETRIES: Record<AssetShape, THREE.BufferGeometry> = {
  sphere: new THREE.SphereGeometry(0.5, 18, 14),
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 18),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
  // Default torus: ring radius 0.4, tube radius 0.15 — chunky rim, good
  // for hat bands, crowns, donuts.
  torus: new THREE.TorusGeometry(0.4, 0.15, 12, 24),
  // Thin-rim torus: same ring radius, much thinner tube — good for
  // glasses frames, halos, wedding rings.
  torus_thin: new THREE.TorusGeometry(0.4, 0.05, 8, 32),
  // Top dome: upper hemisphere, radius 0.5, opens downward (-Y face is
  // the open side). Good for helmet shells, hoods, bowls, igloos. Rotate
  // to get other orientations (e.g., [Math.PI, 0, 0] for an opening
  // facing up like a soup bowl).
  half_sphere: new THREE.SphereGeometry(0.5, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2),
  // Capsule: pill along Y. Cylinder section length 0.5 + two hemispheres
  // of radius 0.25 → total Y extent 1.0 (-0.5..+0.5), X/Z extent ±0.25.
  // Good for limbs, fingers, sausages, fish bodies, candles, bananas.
  capsule: new THREE.CapsuleGeometry(0.25, 0.5, 4, 12),
  // Star: 5-pointed star extruded along Z. Outer-point radius 0.5, inner
  // radius 0.2, depth 0.2 (Z spans ±0.1). Top point at +Y at default
  // rotation. Good for wand tips, badges, holiday ornaments, stickers.
  star: makeStarGeometry(),
  // Frustum (truncated cone): cylinder with smaller top, wider bottom.
  // Top radius 0.25, bottom radius 0.5, height 1 (Y spans ±0.5). Good
  // for cups, vases, lampshades, beehives, top-hat crowns.
  frustum: new THREE.CylinderGeometry(0.25, 0.5, 1, 18),
  // Pyramid: cone with 4 radial segments → square-base pyramid. Apex at
  // +0.5 Y, base at -0.5 Y, base corners at ±0.5 X/Z. Good for Egyptian
  // pyramids, tents, party hats, simple roofs.
  pyramid: new THREE.ConeGeometry(0.5, 1, 4),
  // Wedge (triangular prism): apex up at +0.5 Y, base at -0.5 Y, depth
  // along Z spans ±0.5. Good for slices of pie/cheese/watermelon, ramps
  // (rotate), bird beaks, simple roofs.
  wedge: makeWedgeGeometry(),
  // Heart: extruded 2D heart. Lobes at top, point at bottom, fits within
  // ±0.5 in X/Y, depth ±0.15 in Z. Good for valentines, heart-eyes,
  // jewelry, decorations.
  heart: makeHeartGeometry(),
  // Crescent: half-arc partial torus, ring radius 0.4 with tube 0.1 over
  // an arc of π. Spans ±0.5 in X, ±0.3 in Y after centering, ±0.1 in Z.
  // Good for moons, smiles, eyebrows, mustaches.
  crescent: makeCrescentGeometry(),
};

function makeStarGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const outerR = 0.5;
  const innerR = 0.2;
  const points = 5;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    // Start at top (+Y) and walk CCW.
    const a = (Math.PI / points) * i - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
  geom.translate(0, 0, -0.1);
  return geom;
}

function makeWedgeGeometry(): THREE.BufferGeometry {
  // Symmetric tent triangle: apex at +0.5 Y, base from -0.5 to +0.5 X
  // at -0.5 Y. Extruded by 1 along Z and centered.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5);
  shape.lineTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geom.translate(0, 0, -0.5);
  return geom;
}

function makeHeartGeometry(): THREE.BufferGeometry {
  // THREE.js docs heart shape, then center + normalize so the larger of
  // X/Y spans ±0.5 (preserving aspect) and Z is depth-scaled to ±0.15.
  const x = 0;
  const y = 0;
  const s = new THREE.Shape();
  s.moveTo(x + 5, y + 5);
  s.bezierCurveTo(x + 5, y + 5, x + 4, y, x, y);
  s.bezierCurveTo(x - 6, y, x - 6, y + 7, x - 6, y + 7);
  s.bezierCurveTo(x - 6, y + 11, x - 3, y + 15.4, x + 5, y + 19);
  s.bezierCurveTo(x + 12, y + 15.4, x + 16, y + 11, x + 16, y + 7);
  s.bezierCurveTo(x + 16, y + 7, x + 16, y, x + 10, y);
  s.bezierCurveTo(x + 7, y, x + 5, y + 5, x + 5, y + 5);
  const geom = new THREE.ExtrudeGeometry(s, { depth: 6, bevelEnabled: false });
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  const sx = bb.max.x - bb.min.x;
  const sy = bb.max.y - bb.min.y;
  const sz = bb.max.z - bb.min.z;
  const maxDim = Math.max(sx, sy);
  geom.translate(-(bb.min.x + sx / 2), -(bb.min.y + sy / 2), -(bb.min.z + sz / 2));
  // Source heart traces with the V of the lobes at low Y and the point
  // at high Y. Flip Y so the conventional "lobes-up, point-down" reads
  // right at default rotation.
  geom.scale(1 / maxDim, -1 / maxDim, 0.3 / sz);
  return geom;
}

function makeCrescentGeometry(): THREE.BufferGeometry {
  const geom = new THREE.TorusGeometry(0.4, 0.1, 8, 32, Math.PI);
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  const cy = (bb.min.y + bb.max.y) / 2;
  geom.translate(0, -cy, 0);
  return geom;
}

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
