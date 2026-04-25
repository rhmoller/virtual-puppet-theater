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
//   Clawd's stall line covers the brief silence and he can comment
//   naturally on the next turn that he couldn't picture it.

import Anthropic from "@anthropic-ai/sdk";
import { ASSET_SPEC_JSON_SCHEMA, type AssetSpec } from "./protocol.ts";

const ASSET_MODEL = "claude-opus-4-7";

// Tight brief for the asset designer. Worked examples ground the shape
// of the output and keep the agent from going overboard on part counts.
// `cache_control: ephemeral` will reuse this prefix once it's been seen.
const SYSTEM_PROMPT = `You are an asset designer for a small kid-facing puppet theater. You compose visual props out of a tiny set of THREE.js primitives — sphere, box, cone, cylinder, torus — each with a color, position, rotation, and scale. Your output is a JSON AssetSpec ({ "parts": [...] }), nothing else.

Constraints:
- Use 1–6 parts. Lower is better — silhouette reads at a distance.
- Coordinates are in slot-local space. The piece will mount on a puppet's slot (head, hand, etc.) or at a scene anchor. Keep the piece centered around the origin (0,0,0). Vertical extent typically ranges from -0.5 to 1.5 units.
- Colors are CSS-style hex strings ("#ff8800" for orange, "#4caf50" for green, "#2a2a2a" for near-black). Use saturated, friendly colors — kid-show palette.
- Scale values are absolute multipliers on a unit primitive (sphere/box/cone/cylinder/torus all unit-sized). Typical values are 0.1 to 2.0 per axis.
- Keep parts contiguous — they should look like one object. Don't scatter pieces.
- Don't include text, decals, or anything beyond the 5 primitives.

Examples:

A watermelon hat (cosmetic, mounts at slot=head):
{"parts":[
  {"shape":"sphere","color":"#2e7d32","position":[0,1.0,0],"rotation":[0,0,0],"scale":[1.4,0.7,1.4]},
  {"shape":"sphere","color":"#ff5252","position":[0,1.0,0],"rotation":[0,0,0],"scale":[1.3,0.62,1.3]}
]}

A giant rubber duck (scene prop, mounts at an anchor):
{"parts":[
  {"shape":"sphere","color":"#ffeb3b","position":[0,0.4,0],"rotation":[0,0,0],"scale":[0.9,0.8,1.2]},
  {"shape":"sphere","color":"#ffeb3b","position":[0,1.0,0.4],"rotation":[0,0,0],"scale":[0.55,0.5,0.55]},
  {"shape":"cone","color":"#ff9800","position":[0,1.0,0.85],"rotation":[1.57,0,0],"scale":[0.18,0.3,0.18]},
  {"shape":"sphere","color":"#111111","position":[0.18,1.1,0.6],"rotation":[0,0,0],"scale":[0.06,0.06,0.06]},
  {"shape":"sphere","color":"#111111","position":[-0.18,1.1,0.6],"rotation":[0,0,0],"scale":[0.06,0.06,0.06]}
]}

A pair of star-shaped sunglasses (cosmetic, mounts at slot=eyes):
{"parts":[
  {"shape":"sphere","color":"#ffd23a","position":[-0.32,0,0.05],"rotation":[0,0,0],"scale":[0.32,0.32,0.05]},
  {"shape":"sphere","color":"#ffd23a","position":[0.32,0,0.05],"rotation":[0,0,0],"scale":[0.32,0.32,0.05]},
  {"shape":"box","color":"#2a2a2a","position":[0,0,0.05],"rotation":[0,0,0],"scale":[0.18,0.04,0.04]}
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
