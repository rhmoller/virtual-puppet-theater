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
//
// `slice`, `lathe`, and `extrude` are NOT in this cache — they're built
// per-part from spec fields (contour / sweep / lathe_sweep / taper).
type CachedShape = Exclude<AssetShape, "slice" | "lathe" | "extrude">;
const GEOMETRIES: Record<CachedShape, THREE.BufferGeometry> = {
  sphere: new THREE.SphereGeometry(0.5, 18, 14),
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 18),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
  // Torus: ring radius 0.4, tube radius 0.15 — chunky rim, good for hat
  // bands, crowns, donuts. For thinner rings, scale_z down or use a lathe.
  torus: new THREE.TorusGeometry(0.4, 0.15, 12, 24),
  // Top dome: upper hemisphere, radius 0.5, opens downward (-Y face is
  // the open side). Good for helmet shells, hoods, bowls, igloos. Rotate
  // to get other orientations (e.g., [Math.PI, 0, 0] for an opening
  // facing up like a soup bowl).
  half_sphere: new THREE.SphereGeometry(0.5, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2),
  // Capsule: pill along Y. Cylinder section length 0.5 + two hemispheres
  // of radius 0.25 → total Y extent 1.0 (-0.5..+0.5), X/Z extent ±0.25.
  // Good for limbs, fingers, sausages, fish bodies, candles.
  capsule: new THREE.CapsuleGeometry(0.25, 0.5, 4, 12),
  // Star: 5-pointed star extruded along Z. Outer-point radius 0.5, inner
  // radius 0.2, depth 0.2 (Z spans ±0.1). Top point at +Y at default
  // rotation. Good for wand tips, badges, holiday ornaments, stickers.
  star: makeStarGeometry(),
  // Heart: extruded 2D heart. Lobes at top, point at bottom, fits within
  // ±0.5 in X/Y, depth ±0.15 in Z. Good for valentines, heart-eyes,
  // jewelry, decorations.
  heart: makeHeartGeometry(),
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

// Build a circular sector — the silhouette of a pizza slice / cake slice
// / pie wedge / cheese wedge viewed face-on. Apex at +Y top, arc curving
// down-and-around at -Y. `sweepRad` is the angle of the wedge in radians;
// 60° (π/3) is a typical 1/6 slice. The shape's radius is 0.5 so it fits
// inside ±0.5 in X for sweeps up to ~60°; wider sweeps overflow X.
//
// Z depth is 1.0 (extruded), so the unscaled slab spans ±0.5 in Z. This
// matches box/wedge/cylinder convention so scale_z applied to the part
// directly equals the slab's thickness — and after the lay-flat rotation
// [π/2,0,0], scale_z is the slab's Y-thickness in slot-local space.
function makeSliceGeometry(sweepRad: number): THREE.BufferGeometry {
  const r = 0.5;
  const halfSweep = sweepRad / 2;
  const startAngle = -Math.PI / 2 - halfSweep;
  const endAngle = -Math.PI / 2 + halfSweep;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(r * Math.cos(startAngle), r * Math.sin(startAngle));
  shape.absarc(0, 0, r, startAngle, endAngle, false);
  shape.lineTo(0, 0);
  const geom = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false });
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  const cy = (bb.min.y + bb.max.y) / 2;
  geom.translate(0, -cy, -0.5);
  return geom;
}

// Sample a 2D contour into a list of points. If `smooth`, run the points
// through a Catmull-Rom spline so the silhouette is curvy; otherwise
// connect them as a straight polyline. Used by both lathe and extrude.
function sampleContour(
  points: ReadonlyArray<readonly [number, number]>,
  smooth: boolean,
  samples: number,
): THREE.Vector2[] {
  if (points.length < 2) return [];
  const v2s = points.map(([x, y]) => new THREE.Vector2(x, y));
  if (!smooth) return v2s;
  const curve = new THREE.SplineCurve(v2s);
  return curve.getPoints(samples);
}

// Lathe: revolve a 2D contour around the Y axis. Contour points are
// (radial distance, height). For a closed solid the contour should
// touch the axis (x=0) at both the top and the bottom so the geometry
// caps itself.
//
// THREE.LatheGeometry produces outward-facing normals only when the
// contour points run BOTTOM-TO-TOP (ascending Y). LLMs often emit them
// top-to-bottom, which silently flips the triangle winding so you see
// the back faces (the shape looks faintly inside-out / hollow). We
// auto-reverse here when first.y > last.y so either ordering renders
// correctly.
//
// Caps and tapering are NOT supported on lathe — the same effects (a
// half-bell, a tapered horn, a fluted column-with-cutout) can be built
// with extrude-along-path, which already supports caps and taper.
function makeLatheGeometry(
  contour: { points: ReadonlyArray<readonly [number, number]>; smooth?: boolean },
  sweep: number,
): THREE.BufferGeometry | null {
  const sampled = sampleContour(contour.points, contour.smooth ?? false, 32);
  if (sampled.length < 2) return null;
  if (sampled[0]!.y > sampled[sampled.length - 1]!.y) {
    sampled.reverse();
  }
  return new THREE.LatheGeometry(sampled, 32, 0, sweep);
}

// Linear-interpolate a taper schedule at parameter t ∈ [0,1].
function taperAt(taper: ReadonlyArray<number>, t: number): number {
  if (taper.length === 0) return 1;
  if (taper.length === 1) return taper[0]!;
  const idx = t * (taper.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(taper.length - 1, i0 + 1);
  const frac = idx - i0;
  return taper[i0]! * (1 - frac) + taper[i1]! * frac;
}

type CapKind = "flat" | "pointy" | "rounded" | "none";

// Append a cap (flat/pointy/rounded) to the geometry buffers. The cap
// closes off the extrude at one endpoint. The terminal side-wall ring
// (perimeter) is shared via `ringStartIdx` — we only add new vertices
// for apex / interior triangulation / intermediate hemisphere rings.
//
// `outward` is +1 for the END cap (cap normal = +tangent) and -1 for the
// START cap (cap normal = -tangent). Triangle winding flips between the
// two so vertex-normal computation produces outward-facing surfaces.
function appendExtrudeCap(
  positions: number[],
  indices: number[],
  contourPts: ReadonlyArray<THREE.Vector2>,
  holePts: ReadonlyArray<ReadonlyArray<THREE.Vector2>>,
  endpoint: THREE.Vector3,
  tangent: THREE.Vector3,
  normal: THREE.Vector3,
  binormal: THREE.Vector3,
  baseScale: number,
  outward: 1 | -1,
  kind: CapKind,
  ringStartIdx: number,
): void {
  if (kind === "none") return;
  const N = contourPts.length;

  // Contour's bounding radius drives apex distance for pointy/rounded.
  let r = 0;
  for (const p of contourPts) {
    const d = Math.hypot(p.x, p.y);
    if (d > r) r = d;
  }
  r *= baseScale;

  if (kind === "flat") {
    // Triangulate the 2D contour (and any holes) with ShapeGeometry,
    // then place the resulting vertices in the cross-section plane at
    // the endpoint.
    const shape = new THREE.Shape();
    shape.moveTo(contourPts[0]!.x, contourPts[0]!.y);
    for (let k = 1; k < N; k++) shape.lineTo(contourPts[k]!.x, contourPts[k]!.y);
    shape.closePath();
    for (const holeRing of holePts) {
      if (holeRing.length < 3) continue;
      const path = new THREE.Path();
      path.moveTo(holeRing[0]!.x, holeRing[0]!.y);
      for (let k = 1; k < holeRing.length; k++) {
        path.lineTo(holeRing[k]!.x, holeRing[k]!.y);
      }
      path.closePath();
      shape.holes.push(path);
    }
    const cap = new THREE.ShapeGeometry(shape, 1);
    const cpos = cap.getAttribute("position").array;
    const cidx = cap.getIndex()!.array;
    const baseIdx = positions.length / 3;
    for (let k = 0; k < cpos.length; k += 3) {
      const cx = cpos[k]!;
      const cy = cpos[k + 1]!;
      positions.push(
        endpoint.x + (cx * binormal.x + cy * normal.x) * baseScale,
        endpoint.y + (cx * binormal.y + cy * normal.y) * baseScale,
        endpoint.z + (cx * binormal.z + cy * normal.z) * baseScale,
      );
    }
    // With the world-up frame, normal × tangent = +binormal so the
    // (binormal, normal) plane has cross(binormal, normal) = +tangent.
    // ShapeGeometry's natural CCW winding gives triangles whose normal
    // is +tangent (forward along the path). That's correct for the END
    // cap (outward = +tangent); reverse for the START cap.
    for (let k = 0; k < cidx.length; k += 3) {
      const a = baseIdx + cidx[k]!;
      const b = baseIdx + cidx[k + 1]!;
      const c = baseIdx + cidx[k + 2]!;
      if (outward === 1) indices.push(a, b, c);
      else indices.push(a, c, b);
    }
    cap.dispose();
    return;
  }

  if (kind === "pointy") {
    const apexDist = r;
    const apexIdx = positions.length / 3;
    positions.push(
      endpoint.x + outward * tangent.x * apexDist,
      endpoint.y + outward * tangent.y * apexDist,
      endpoint.z + outward * tangent.z * apexDist,
    );
    // Fan: connect apex to each pair of consecutive perimeter vertices
    // on the side-wall's terminal ring. World-up frame has CCW contour
    // → CCW (in 2D plane) wrapping; for outward apex normals, end cap
    // (outward=+1) keeps natural winding, start cap reverses.
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = ringStartIdx + j;
      const b = ringStartIdx + j2;
      if (outward === 1) indices.push(apexIdx, a, b);
      else indices.push(apexIdx, b, a);
    }
    return;
  }

  // "rounded" — hemispherical cap. Add `segments-1` intermediate rings
  // following the parametrization (dist = r·t, scale = √(1-t²)) for t in
  // (0,1), plus a single apex vertex at t=1.
  const segments = 5;
  const ringIdxs: number[] = [];
  for (let s = 1; s < segments; s++) {
    const t = s / segments;
    const dist = r * t;
    const scaleAt = Math.sqrt(Math.max(0, 1 - t * t));
    const ringIdx = positions.length / 3;
    ringIdxs.push(ringIdx);
    for (const cp of contourPts) {
      const cx = cp.x * scaleAt;
      const cy = cp.y * scaleAt;
      positions.push(
        endpoint.x + outward * tangent.x * dist + (cx * binormal.x + cy * normal.x) * baseScale,
        endpoint.y + outward * tangent.y * dist + (cx * binormal.y + cy * normal.y) * baseScale,
        endpoint.z + outward * tangent.z * dist + (cx * binormal.z + cy * normal.z) * baseScale,
      );
    }
  }
  const apexIdx = positions.length / 3;
  positions.push(
    endpoint.x + outward * tangent.x * r,
    endpoint.y + outward * tangent.y * r,
    endpoint.z + outward * tangent.z * r,
  );

  // Connect side-wall terminal ring → first cap ring → ... → apex.
  // Same winding convention as the side walls: end cap (outward=+1)
  // uses (a,b,c,b,d,c) for outward normals; start cap reverses.
  let prev = ringStartIdx;
  for (const next of ringIdxs) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = prev + j;
      const b = prev + j2;
      const c = next + j;
      const d = next + j2;
      if (outward === 1) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
    prev = next;
  }
  // Fan to apex from the last ring (same convention as pointy fan).
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    const a = prev + j;
    const b = prev + j2;
    if (outward === 1) indices.push(apexIdx, a, b);
    else indices.push(apexIdx, b, a);
  }
}

// Compute orientation frames along a curve. Unlike THREE.js's built-in
// computeFrenetFrames (which picks an arbitrary initial normal that can
// be inverted relative to world up), this uses world-up as the reference
// for the cross-section's "up" axis, then propagates via parallel
// transport along the curve. Result: contour-local Y stays aligned with
// world-up wherever the path is roughly horizontal, so a contour drawn
// "upright" extrudes upright in the world. Falls back to +X reference
// when the path is parallel to world up (vertical).
function computePathFrames(
  curve: THREE.CatmullRomCurve3,
  samples: number,
): {
  tangents: THREE.Vector3[];
  normals: THREE.Vector3[];
  binormals: THREE.Vector3[];
} {
  const tangents: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  const worldUp = new THREE.Vector3(0, 1, 0);
  const fallbackUp = new THREE.Vector3(1, 0, 0);

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const tangent = curve.getTangentAt(t).normalize();

    let normal: THREE.Vector3;
    if (i === 0) {
      // Initial normal: project world-up onto the plane perpendicular
      // to the tangent. If tangent is parallel to world-up, use +X.
      const ref = Math.abs(worldUp.dot(tangent)) > 0.95 ? fallbackUp : worldUp;
      normal = ref.clone().sub(tangent.clone().multiplyScalar(ref.dot(tangent)));
    } else {
      // Parallel transport: project the previous normal onto the new
      // perpendicular plane. Keeps the frame from twisting at inflection
      // points.
      const prev = normals[i - 1]!;
      normal = prev.clone().sub(tangent.clone().multiplyScalar(prev.dot(tangent)));
      if (normal.lengthSq() < 1e-6) {
        const ref = Math.abs(worldUp.dot(tangent)) > 0.95 ? fallbackUp : worldUp;
        normal = ref.clone().sub(tangent.clone().multiplyScalar(ref.dot(tangent)));
      }
    }
    normal.normalize();
    // binormal = normal × tangent, chosen so that contour's +X (binormal)
    // ends up pointing in world +X for a path along +Z. Verify:
    //   tangent +Z, normal +Y → binormal = +Y × +Z = +X ✓
    const binormal = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    // Re-orthogonalize normal against the now-stable binormal.
    normal.crossVectors(tangent, binormal).normalize();

    tangents.push(tangent);
    normals.push(normal);
    binormals.push(binormal);
  }
  return { tangents, normals, binormals };
}

// Extrude a 2D contour along a 3D Catmull-Rom path with optional taper
// and end caps. The contour lies in the plane perpendicular to the
// path's tangent at each sample. World-up-referenced frames keep the
// contour's "up" aligned with world Y wherever possible, so contour
// coordinates map to world axes intuitively (cp.x→world X, cp.y→world Y
// for a horizontal path along +Z).
function makeExtrudeAlongPathGeometry(
  contour: {
    points: ReadonlyArray<readonly [number, number]>;
    holes?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
    smooth?: boolean;
  },
  path: ReadonlyArray<readonly [number, number, number]>,
  taper: ReadonlyArray<number>,
  capStart: CapKind,
  capEnd: CapKind,
): THREE.BufferGeometry | null {
  if (path.length < 2) return null;
  const smooth = contour.smooth ?? false;
  const contourPts = sampleContour(contour.points, smooth, 24);
  if (contourPts.length < 2) return null;
  const holePts = (contour.holes ?? [])
    .map((h) => sampleContour(h, smooth, 24))
    .filter((h) => h.length >= 3);

  // Each perimeter (outer + each hole) is its own connected ring loop
  // in the cross-section. Walls connect adjacent rings within each
  // perimeter independently. Hole walls flip their winding so the
  // surface normals point INTO the hole (toward whoever is looking
  // through the passage).
  const perimeters: { pts: ReadonlyArray<THREE.Vector2>; isHole: boolean }[] = [
    { pts: contourPts, isHole: false },
    ...holePts.map((pts) => ({ pts, isHole: true })),
  ];

  const path3 = path.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(path3, false, "catmullrom", 0.5);
  const samples = 64;
  const frames = computePathFrames(curve, samples);

  const positions: number[] = [];
  const indices: number[] = [];

  // Per-perimeter ring start indices (so we know where each perimeter's
  // terminal ring lives for cap attachment).
  const ringStartByPerimeter: number[][] = [];

  for (const { pts, isHole } of perimeters) {
    const Np = pts.length;
    const ringStarts: number[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const center = curve.getPointAt(t);
      const normal = frames.normals[i]!;
      const binormal = frames.binormals[i]!;
      const s = taperAt(taper, t);
      ringStarts.push(positions.length / 3);
      for (const cp of pts) {
        positions.push(
          center.x + (cp.x * binormal.x + cp.y * normal.x) * s,
          center.y + (cp.x * binormal.y + cp.y * normal.y) * s,
          center.z + (cp.x * binormal.z + cp.y * normal.z) * s,
        );
      }
    }
    ringStartByPerimeter.push(ringStarts);
    // Connect adjacent rings within this perimeter. With the world-up
    // frame, contour CCW in 2D maps to CCW in the world XY plane (for
    // path along +Z), and the cross product (c-a)×(b-a) for vertex
    // order (a,c,b) points INWARD radially. To get outward normals on
    // the outer perimeter we use (a, b, c, b, d, c) instead.
    for (let i = 0; i < samples; i++) {
      const aRow = ringStarts[i]!;
      const cRow = ringStarts[i + 1]!;
      for (let j = 0; j < Np; j++) {
        const j2 = (j + 1) % Np;
        const a = aRow + j;
        const b = aRow + j2;
        const c = cRow + j;
        const d = cRow + j2;
        if (!isHole) {
          // Outer perimeter — outward normals.
          indices.push(a, b, c, b, d, c);
        } else {
          // Hole perimeter — opposite winding so normals face into the hole.
          indices.push(a, c, b, b, c, d);
        }
      }
    }
  }

  // Tangents for caps.
  const startTangent = frames.tangents[0]!;
  const endTangent = frames.tangents[samples]!;
  const startNormal = frames.normals[0]!;
  const startBinormal = frames.binormals[0]!;
  const endNormal = frames.normals[samples]!;
  const endBinormal = frames.binormals[samples]!;
  const startScale = taperAt(taper, 0);
  const endScale = taperAt(taper, 1);

  appendExtrudeCap(
    positions,
    indices,
    contourPts,
    holePts,
    curve.getPointAt(0),
    startTangent,
    startNormal,
    startBinormal,
    startScale,
    -1,
    capStart,
    ringStartByPerimeter[0]![0]!,
  );
  appendExtrudeCap(
    positions,
    indices,
    contourPts,
    holePts,
    curve.getPointAt(1),
    endTangent,
    endNormal,
    endBinormal,
    endScale,
    1,
    capEnd,
    ringStartByPerimeter[0]![samples]!,
  );

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export function renderSpec(spec: AssetSpec): THREE.Group {
  const group = new THREE.Group();
  for (const part of spec.parts) {
    let geom: THREE.BufferGeometry | null;
    if (part.shape === "slice") {
      geom = makeSliceGeometry(part.sweep ?? Math.PI / 3);
    } else if (part.shape === "lathe") {
      geom = part.contour
        ? makeLatheGeometry(part.contour, part.lathe_sweep ?? Math.PI * 2)
        : null;
    } else if (part.shape === "extrude") {
      geom =
        part.contour && part.path
          ? makeExtrudeAlongPathGeometry(
              part.contour,
              part.path,
              part.taper ?? [1, 1],
              part.cap_start ?? "flat",
              part.cap_end ?? "flat",
            )
          : null;
    } else {
      geom = GEOMETRIES[part.shape] ?? null;
    }
    if (!geom) continue;

    const transparent = part.transparent === true;
    const mat = new THREE.MeshStandardMaterial({
      color: parseColor(part.color),
      roughness: 0.7,
      transparent,
      opacity: transparent ? 0.5 : 1.0,
      depthWrite: !transparent,
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
