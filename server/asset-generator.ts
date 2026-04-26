// AssetGenerator — parallel Claude Opus 4.7 call that designs novel
// cosmetics and scene props on the fly, returning a parametric
// AssetSpec the client renders the same way it renders pre-fab items.
//
// Design notes:
// - Always pinned to claude-opus-4-7. Composing a coherent shape from
//   primitives needs Opus's spatial reasoning; Haiku produces blobs.
//   This also keeps Opus 4.7 squarely on the demo path even when the
//   conversation puppet is the small-brain Haiku variant.
// - The LLM call is independent — its own message thread, its own
//   system prompt, its own structured-output schema. Nothing about it
//   is shared with the conversation Session.
// - Cache: an in-process Map keyed by a normalized description hash so
//   the second ask for the same thing is sub-second.
// - Errors (timeout, schema fail) are swallowed at the call site —
//   the stage puppet's stall line covers the brief silence and it can
//   comment naturally on the next turn that it couldn't picture it.

import Anthropic from "@anthropic-ai/sdk";
import { ASSET_SPEC_JSON_SCHEMA, type AssetSpec } from "./protocol.ts";

const ASSET_MODEL = "claude-opus-4-7";

// Tight brief for the asset designer. Worked examples ground the shape
// of the output and keep the agent from going overboard on part counts.
// `cache_control: ephemeral` will reuse this prefix once it's been seen.
const SYSTEM_PROMPT = `You are an asset designer for a small kid-facing puppet theater. You compose visual props out of a set of THREE.js primitives — sphere, half_sphere, box, cone, cylinder, capsule, frustum, pyramid, wedge, torus, torus_thin, star, heart, crescent — each with a color, position, rotation, and scale. Your output is a JSON AssetSpec ({ "parts": [...] }), nothing else.

# Coordinate system

- +X = the puppet's right
- +Y = up
- +Z = toward the viewer (out of the screen)
- Coordinates are in slot-local space. (0,0,0) is the canonical mount point.

# Primitive defaults (rotation [0,0,0])

Unit-scale primitives are SMALL: each spans roughly -0.5..+0.5 on its main axes. Most cosmetics need scale ≥ 1.5 to read at the right size on the puppet.

- sphere: radius 0.5 at scale 1 (spans -0.5..+0.5). Scale 2 → radius 1.0 (matches the head's footprint).
- half_sphere: top hemisphere, radius 0.5 at scale 1 (spans -0.5..+0.5 in X/Z, 0..+0.5 in Y — open downward). Rotate [Math.PI, 0, 0] to flip it open-upward (like a bowl). Good for helmet shells, hoods, domes, bowls, igloos.
- box: unit cube, spans -0.5..+0.5 on every axis.
- cone: tip at +0.5 Y, base at -0.5 Y; base radius 0.5; height 1.
- cylinder: long axis along Y; height 1, radius 0.5.
- capsule: pill along Y. Total height 1 (-0.5..+0.5), radius 0.25 (X/Z spans ±0.25). Good for limbs, fingers, sausages, fish bodies, candles, bananas, hot dogs, pencils.
- frustum: truncated cone (cup-shape). Top radius 0.25, bottom radius 0.5, height 1 (Y spans ±0.5). Good for cups, vases, lampshades, beehives, top-hat crowns. Rotate [Math.PI, 0, 0] for an inverted version (flower-pot).
- pyramid: square-base pyramid. Apex at +0.5 Y, base square corners at ±0.5 X/Z at -0.5 Y. Good for Egyptian pyramids, tents, party hats with square base, simple roofs.
- wedge: triangular prism (tent shape). Apex at +0.5 Y, base across -0.5..+0.5 X at -0.5 Y, depth ±0.5 Z. Good for pie/cheese/watermelon slices, ramps (rotate so base is on the ground), bird beaks, dorsal fins.
- torus: ring radius 0.4, tube radius 0.15 → outer radius 0.55, hole radius 0.25. Default lies in XY plane (axis along Z, faces the viewer). Chunky rim — good for crowns, hat bands, donuts.
- torus_thin: ring radius 0.4, tube radius 0.05 → outer radius 0.45, hole radius 0.35. Same plane. Wire-frame look — good for glasses, halos, wedding rings.
- star: 5-pointed star extruded along Z. Outer-point radius 0.5, inner radius 0.2, depth 0.2 (Z ±0.1). Top point at +Y at default rotation. Good for wand tips, sheriff badges, holiday ornaments, sparkles, stickers.
- heart: extruded 2D heart. Lobes at top, point at bottom, fits within ±0.5 in X/Y, depth ±0.15 in Z. Good for valentines, heart-eyes, lockets, decorations on cakes/clothes.
- crescent: half-arc (moon/smile shape). Spans ±0.5 in X, ±0.3 in Y, ±0.1 in Z. At default rotation the arc opens DOWNWARD (like a frown / rainbow / mustache). Rotate [0, 0, Math.PI] to open upward (smile/bowl-arc). Good for moons, smiles, eyebrows, mustaches, bananas.

Use rotation to reorient: e.g., "cylinder along Z (lying forward)" needs rotation [Math.PI/2, 0, 0] = [1.57, 0, 0]. "Cone pointing forward" needs the same.

# Scale anchor: the puppet's head is a sphere of radius 1.0

A unit sphere is only radius 0.5, so scale 2.0 matches the head's footprint. Generated assets should READ at camera distance — err on the side of generous, not dainty. Tiny props look broken on screen.

# Connectedness — estimate each part's extent before placing

Pieces look broken when they don't touch. Before emitting an Asset, mentally compute each part's bounding extent and confirm neighbors overlap or share a face. Formulas (for rotation 0):

- sphere: half-extent = 0.5 × scale on every axis. A sphere at position [0, 0.95, 0] scale [1.5, 0.75, 1.5] spans Y from 0.575 to 1.325.
- half_sphere (default rotation, open downward): X/Z half-extent = 0.5 × scale; Y range = position.y to position.y + 0.5 × scale_y (the dome rises above its position).
- box: half-extent = 0.5 × scale on every axis. A box at [0, 0, 0] scale [1, 0.2, 0.5] spans Y from -0.1 to +0.1.
- cone: radius half-extent = 0.5 × scale_x or scale_z; height = 1 × scale_y (base at -0.5 × scale_y, tip at +0.5 × scale_y, when at position 0).
- cylinder: same as cone for the disk; height as cone.
- torus / torus_thin: lie in XY plane; ring outer radius = 0.55 (or 0.45 for thin) × scale_xy; thickness in Z = tube radius × scale_z.

A spike on top of a helmet must have its **base** inside the **top** of the shell — if the cone's base is at y > shell_top, you have a gap. Brims need to **overlap** the hat body, not float beneath. Pieces merging slightly into each other reads as one object; small gaps read as broken.

# Scale targets by mount type

- Cosmetic on slot=head (hat, helmet, crown):
  - Hat brim (cylinder/disk): scale ~1.6–2.0 across (radius 0.8–1.0, matches or exceeds head width).
  - Hat crown / dome: sphere/cylinder at scale ~1.4–2.0.
  - Helmet or hood: a main shell (sphere) at slot-origin (0, 0, 0) scaled ~2.0–2.4 so it ENCLOSES the head. Visors, spikes, ear-flaps attach to that shell. A small sphere floating above the head reads as a marble, not a helmet.
- Cosmetic on slot=eyes (glasses, mask, eyepatch): the eyes themselves are at slot-local x = ±0.4 (left eye at -0.4, right eye at +0.4) with eye sphere radius ~0.22. Center each lens on its corresponding eye position (x = ±0.4), at z = 0.15–0.20 to clear the pupil. Lens outer radius ~0.3–0.4 (slightly larger than the eye). For solid lenses (sunglasses), use cylinder rotated [Math.PI/2, 0, 0]. For ring-style glasses, use torus_thin — at scale_xy ~0.7–0.8 the hole (inner radius ~0.245–0.28) is wide enough that the eye reads through the rim. Don't use plain torus for glasses; the rim is too chunky.
- Cosmetic on slot=neck (necklace, bowtie, scarf): ~0.6–1.0 wide, hangs y≈-0.3 below the neckline.
- Cosmetic on slot=hand_left or hand_right (held items: sword, wand, flower, lollipop, fish): the held part extends along +Z (forward, away from the body). Sword/wand/staff length ~1.0–1.5; held flowers/sweets ~0.4–0.8.
- Scene prop at an anchor: 1.0–3.0 across so it reads against the stage from the camera.

# Constraints

- Use 1–6 parts. Lower is better — silhouette reads at a distance.
- Center the piece around the slot origin. Hats sit with their brim around y≈0.9 (top of the head); held items hang their grip near (0,0,0) and extend along +Z.
- Colors are hex strings ("#ff8800", "#4caf50", "#2a2a2a"). Saturated, friendly, kid-show palette.
- Keep parts contiguous — one coherent object, not scattered pieces.
- Don't include text, decals, or anything beyond the 5 primitives.

# Examples

A watermelon hat (cosmetic, mounts at slot=head):
{"parts":[
  {"shape":"sphere","color":"#2e7d32","position":[0,0.95,0],"rotation":[0,0,0],"scale":[1.5,0.75,1.5]},
  {"shape":"sphere","color":"#ff5252","position":[0,0.95,0],"rotation":[0,0,0],"scale":[1.4,0.66,1.4]}
]}

A wooden sword (cosmetic, mounts at slot=hand_right; blade extends forward along +Z):
{"parts":[
  {"shape":"sphere","color":"#3a2a1a","position":[0,0,-0.22],"rotation":[0,0,0],"scale":[0.1,0.1,0.1]},
  {"shape":"cylinder","color":"#7a5230","position":[0,0,0],"rotation":[1.57,0,0],"scale":[0.07,0.3,0.07]},
  {"shape":"box","color":"#3a2a1a","position":[0,0,0.22],"rotation":[0,0,0],"scale":[0.45,0.08,0.08]},
  {"shape":"box","color":"#cfd0d4","position":[0,0,0.9],"rotation":[0,0,0],"scale":[0.14,0.04,1.2]}
]}

A giant rubber duck (scene prop, mounts at an anchor):
{"parts":[
  {"shape":"sphere","color":"#ffeb3b","position":[0,0.4,0],"rotation":[0,0,0],"scale":[1.3,1.1,1.6]},
  {"shape":"sphere","color":"#ffeb3b","position":[0,1.3,0.5],"rotation":[0,0,0],"scale":[0.75,0.7,0.75]},
  {"shape":"cone","color":"#ff9800","position":[0,1.3,1.05],"rotation":[1.57,0,0],"scale":[0.22,0.4,0.22]},
  {"shape":"sphere","color":"#111111","position":[0.22,1.45,0.75],"rotation":[0,0,0],"scale":[0.08,0.08,0.08]},
  {"shape":"sphere","color":"#111111","position":[-0.22,1.45,0.75],"rotation":[0,0,0],"scale":[0.08,0.08,0.08]}
]}

A knight's helmet (cosmetic, mounts at slot=head):
{"parts":[
  {"shape":"sphere","color":"#9aa0a8","position":[0,0.2,0],"rotation":[0,0,0],"scale":[2.1,2.0,2.1]},
  {"shape":"box","color":"#2a2a2a","position":[0,0.45,0.95],"rotation":[0,0,0],"scale":[1.6,0.22,0.15]},
  {"shape":"cone","color":"#c93a3a","position":[0,1.5,0],"rotation":[0,0,0],"scale":[0.22,0.8,0.22]}
]}

A pair of star-shaped sunglasses (cosmetic, mounts at slot=eyes):
{"parts":[
  {"shape":"sphere","color":"#ffd23a","position":[-0.4,0,0.15],"rotation":[0,0,0],"scale":[0.32,0.32,0.05]},
  {"shape":"sphere","color":"#ffd23a","position":[0.4,0,0.15],"rotation":[0,0,0],"scale":[0.32,0.32,0.05]},
  {"shape":"box","color":"#2a2a2a","position":[0,0,0.20],"rotation":[0,0,0],"scale":[0.18,0.04,0.04]}
]}

A pair of golden round wire-frame glasses (cosmetic, mounts at slot=eyes):
{"parts":[
  {"shape":"torus_thin","color":"#d4a83a","position":[-0.4,0,0.15],"rotation":[0,0,0],"scale":[0.75,0.75,1.0]},
  {"shape":"torus_thin","color":"#d4a83a","position":[0.4,0,0.15],"rotation":[0,0,0],"scale":[0.75,0.75,1.0]},
  {"shape":"box","color":"#d4a83a","position":[0,0,0.20],"rotation":[0,0,0],"scale":[0.2,0.04,0.04]}
]}

Output the JSON AssetSpec only. No commentary.`;

export class AssetGenerator {
  private client = new Anthropic();
  // Map<descriptionHash, AssetSpec>. In-process — survives across
  // sessions while the server is up. Plenty for the demo.
  private cache = new Map<string, AssetSpec>();

  /**
   * Design a new asset from a free-form description. Returns the spec
   * (from cache if seen before) or null on schema/timeout failure.
   *
   * `mountKind` is included in the cache key so the same description
   * can produce different shapes when used as a hat vs. a scene prop.
   */
  async generate(args: {
    description: string;
    mountKind: "cosmetic" | "prop";
    slotOrAnchor: string;
  }): Promise<AssetSpec | null> {
    const key = cacheKey(args.description, args.mountKind, args.slotOrAnchor);
    const hit = this.cache.get(key);
    if (hit) {
      console.log("[asset-gen] cache hit:", key);
      return hit;
    }

    const userPrompt = composeUserPrompt(args);
    try {
      const response = await this.client.messages.create({
        model: ASSET_MODEL,
        max_tokens: 800,
        // Long stable prefix → cache hits across requests.
        cache_control: { type: "ephemeral" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
          // Opus accepts effort: low — we want a tight, fast response.
          effort: "low",
          format: { type: "json_schema", schema: ASSET_SPEC_JSON_SCHEMA.schema },
        },
      });
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        console.warn("[asset-gen] no text block in response");
        return null;
      }
      const parsed = JSON.parse(textBlock.text) as AssetSpec;
      if (!validateSpec(parsed)) {
        console.warn("[asset-gen] schema mismatch in parsed spec");
        return null;
      }
      this.cache.set(key, parsed);
      console.log(
        `[asset-gen] generated "${args.description}" (${args.mountKind}, ${parsed.parts.length} parts)`,
      );
      console.log("[asset-gen] spec:", JSON.stringify(parsed));
      return parsed;
    } catch (err) {
      console.warn("[asset-gen] error:", err);
      return null;
    }
  }
}

function composeUserPrompt(args: {
  description: string;
  mountKind: "cosmetic" | "prop";
  slotOrAnchor: string;
}): string {
  const where =
    args.mountKind === "cosmetic"
      ? `Cosmetic mounting at slot "${args.slotOrAnchor}" on a puppet`
      : `Scene prop placed at anchor "${args.slotOrAnchor}" in the theater`;
  return `Design: ${args.description}\nMount: ${where}\n\nRespond with the JSON AssetSpec only.`;
}

function cacheKey(description: string, mountKind: string, slotOrAnchor: string): string {
  const normalized = description.trim().toLowerCase();
  return `${mountKind}:${slotOrAnchor}:${normalized}`;
}

// Cheap runtime sanity check on the parsed spec. The Anthropic
// structured-output enforcement is the strict line; this catches the
// unlikely case where the SDK returns something the schema missed.
function validateSpec(s: unknown): s is AssetSpec {
  if (!s || typeof s !== "object") return false;
  const obj = s as { parts?: unknown };
  if (!Array.isArray(obj.parts)) return false;
  if (obj.parts.length === 0 || obj.parts.length > 12) return false;
  return true;
}
