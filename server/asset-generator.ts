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
import { SYSTEM_PROMPT } from "./asset-generator-prompt.ts";

const ASSET_MODEL = "claude-opus-4-7";

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
    // Refinement guidance from a critique of a previous render. Appended
    // to the user prompt so the next attempt can apply specific fixes.
    guidance?: string;
    // Skip the in-process cache lookup — used by the refinement loop
    // where each pass is intentionally a fresh design.
    bypassCache?: boolean;
  }): Promise<AssetSpec | null> {
    const key = cacheKey(args.description, args.mountKind, args.slotOrAnchor);
    if (!args.bypassCache) {
      const hit = this.cache.get(key);
      if (hit) {
        console.log("[asset-gen] cache hit:", key);
        return hit;
      }
    }

    const userPrompt = composeUserPrompt(args);
    try {
      const response = await this.client.messages.create({
        model: ASSET_MODEL,
        max_tokens: 8000,
        // Long stable prefix → cache hits across requests. Cache marker
        // must live on a content block within `system`, not as a
        // top-level call arg.
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: ASSET_SPEC_JSON_SCHEMA.schema },
        },
      });
      if (response.stop_reason === "max_tokens") {
        console.warn("[asset-gen] hit max_tokens — output truncated");
        return null;
      }
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
  guidance?: string;
}): string {
  const where =
    args.mountKind === "cosmetic"
      ? `Cosmetic mounting at slot "${args.slotOrAnchor}" on a puppet`
      : `Scene prop placed at anchor "${args.slotOrAnchor}" in the theater`;
  const guidance = args.guidance
    ? `\n\n# Refinement guidance from a critique of a previous render of this same brief\n${args.guidance}\n\nApply these corrections to your new design — do NOT just regenerate the previous design.`
    : "";
  return `Design: ${args.description}\nMount: ${where}${guidance}\n\nRespond with the JSON AssetSpec only.`;
}

function cacheKey(description: string, mountKind: string, slotOrAnchor: string): string {
  const normalized = description.trim().toLowerCase();
  return `${mountKind}:${slotOrAnchor}:${normalized}`;
}

// Cheap runtime sanity check on the parsed spec. The Anthropic
// structured-output enforcement is the strict line; this catches the
// unlikely case where the SDK returns something the schema missed.
function validateSpec(s: unknown): s is AssetSpec {
  if (!s || typeof s !== "object") {
    console.warn("[asset-gen] validate: not an object");
    return false;
  }
  const obj = s as { parts?: unknown };
  if (!Array.isArray(obj.parts)) {
    console.warn("[asset-gen] validate: parts is not an array");
    return false;
  }
  if (obj.parts.length === 0) {
    console.warn("[asset-gen] validate: parts is empty");
    return false;
  }
  if (obj.parts.length > 50) {
    console.warn(`[asset-gen] validate: too many parts (${obj.parts.length} > 50)`);
    return false;
  }
  return true;
}
