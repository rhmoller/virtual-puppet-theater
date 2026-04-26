# Spec: Co-Creative AI Puppet Theater

**Status:** Draft. Pivot under construction during the final hackathon push.

## Vision

Today the project is "an AI puppet that talks back." This pivot reframes it as **a co-creative play space** — a small theater where a child speaks, and Claude not only performs as a puppet but *directs the scene*: dressing puppets in hats and glasses, placing iconic scene props (moon, tree, sand castle) to evoke a location, and **generating brand-new assets on demand** when the child asks for something the catalog doesn't have. Generated assets are cached so the second ask is instant.

A kid pulls up a hand-puppet on webcam. Claude's puppet is on stage facing them. The kid says "let's go to the beach" — a sun and a beach ball pop into the scene. "I want sunglasses!" — sunglasses appear on the kid's puppet. "Can you have a top hat?" — Claude grows one. "I want a watermelon hat!" — Claude says "ooh, let me dream that up!" and a few seconds later a watermelon-shaped hat appears on top of his head. Asked again next session, it appears instantly from cache.

The aesthetic stays: black-stage puppet theater, no full-backdrop swaps. **Locations are evoked by a few iconic props placed at named anchors — minimalist scenery, maximalist imagination.**

## Why this framing

Maps to the hackathon's prize structure with intent:

- **Build For What's Next** (problem statement): an interface that doesn't have a name yet — a workflow only possible now that Claude can compose new visual assets in real time during a live conversation.
- **Most Creative Opus 4.7 Exploration** ($5k): Opus 4.7 is positioned as a creative medium with a voice, not a tool. Two distinct creative jobs run in parallel — one Claude inhabits a character on stage, another Claude designs new things that didn't exist a moment ago. The asset-design agent is **always Opus 4.7**, even when the conversation puppet is set to Haiku, so Opus's compositional reasoning is on the critical demo path regardless of the user's brain-size choice.
- **Keep Thinking** ($5k): pushes past "AI that talks like a puppet" toward "AI that builds the world with you."

We are not chasing the Managed Agents prize. That product is for long-running async hand-offs; a real-time creative loop is the wrong fit.

## Asset model

Every cosmetic and every scene prop is a **parametric `AssetSpec`** — a small JSON describing a composition of THREE primitives (sphere, box, cone, cylinder, torus) with color, position, rotation, scale. One renderer turns any spec into a `THREE.Group`. This keeps pre-fab and generated assets on the same pipeline.

```ts
type AssetSpec = {
  parts: Array<{
    shape: "sphere" | "box" | "cone" | "cylinder" | "torus";
    color: number;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  }>;
};
```

The expressivity ceiling — primitives + transforms — is exactly where kid-grade props live. A banana hat is a yellow torus plus a brown stem. We deliberately do not allow LLM-emitted code; the JSON-schema floor is the safety guarantee.

## Slots and anchors

**Cosmetic slots, per puppet** (the user hand-puppet and the AI puppet):

- `head`, `eyes`, `neck`, `hand_left`, `hand_right`

Each slot is a `THREE.Group` parented to the rig's existing anchor (the head group, the body group, the arm groups). `dress` wipes-and-replaces the slot group's children — guaranteeing zero animation conflicts because gestures rotate parents, not slot contents.

**Scene anchors, in the theater:**

- `sky_left`, `sky_center`, `sky_right`, `ground_left`, `ground_center`, `ground_right`, `far_back`

Named groups inside the theater module. `place` mounts an asset there; `place null` clears it.

## Pre-fab catalog

Small on purpose — the demo wow comes from the generator, not from quantity.

- **Cosmetics (6):** top_hat, crown, party_hat, sunglasses, round_glasses, wand.
- **Scene props (12):** moon, sun, stars, cloud, tree, mountain, bush, umbrella, sand_castle, beach_ball, car, door, window.

Each is a hand-authored `AssetSpec` factory in `src/assets/catalog.ts`.

## Wire protocol additions

```ts
type Effect =
  | { op: "dress"; puppet: "left" | "right" | "ai"; slot: SlotName; asset: string | null }
  | { op: "place"; anchor: AnchorName; asset: string | null }
  | { op: "request_asset"; kind: "cosmetic" | "prop"; slot_or_anchor: string; description: string; request_id: string };

type Action = { say?; emotion?; gaze?; gesture?; effects?: Effect[] };

type ServerEvent = ... | { type: "asset_ready"; request_id; asset_name; spec };
```

The conversation thread emits `effects` per turn alongside speech. The asset generator runs in a *separate parallel agent call* and pushes `asset_ready` independently when it completes — keeping the conversation responsive while a new asset is being composed.

## Scene state and prompt context

Both client and server track scene state — what each puppet is wearing, what's at each anchor, which generated assets exist. The server injects a compact `[scene: ...]` block alongside the existing `[signal: ...]` block in the user-role message body so Claude doesn't re-issue dress effects every turn or contradict the visible state.

System prompt extension: catalog list, slot/anchor names, examples of multi-effect turns, and the **stall-line guidance** — when emitting `request_asset`, also emit a stalling line in `say` ("ooh, let me dream that up!") so the show doesn't stall while the parallel agent works.

## Asset generation pipeline

`server/asset-generator.ts` runs an independent Claude call:

- **Model: claude-opus-4-7, always.** Even when the session's brain-size toggle is Haiku. Compositional reasoning over primitives is Opus's territory; Haiku doesn't reliably produce a coherent watermelon hat from spheres and tori.
- System prompt: tight description of `AssetSpec` with worked examples (banana hat = yellow torus + brown cone, etc.), `cache_control: ephemeral` so the catalog/spec prefix gets reused.
- Structured output: the same `AssetSpec` JSON schema the runtime renderer consumes.
- Triggered server-side when `request_asset` lands in an `Action`. Conversation continues without blocking; on completion, server pushes `asset_ready` to the client.
- Errors (timeout, schema fail) are swallowed silently — Clawd can comment naturally on the next turn.

**Cache:** server-side `Map<descriptionHash, { name, spec }>` keyed on a normalized description (lowercase, trimmed, slot-prefixed). Cache hits emit `asset_ready` immediately on the next tick. Survives within a process across sessions; that's enough for the demo.

## Tiered scope (≈22h to deadline)

**Tier 1 (must ship, ~6h)** — catalog + scene effects end-to-end, pre-fab only.
**Tier 2 (the magic, ~5h)** — `request_asset` flow with parallel Opus generator + `asset_ready` events + cache.
**Tier 3 (polish, ~2h)** — fade-in animation on mount, IndexedDB persistence, a few more catalog items.

Cut order: drop Tier 3, then drop scene props down to 6, then drop the `neck` slot, then drop user-puppet dressing.

## Demo narrative (3-min hard cap)

1. **Open** — kid raises two puppets, Claude greets them. Establishes the basic interaction.
2. **Catalog dressing** — "give Clawd a crown" → instant; "I want sunglasses" → on the user's puppet.
3. **Scene placement** — "let's go to the beach" → sun + sand_castle + beach_ball appear.
4. **The money shot** — "I want a watermelon hat!" → Clawd: "Ooh, let me dream that up!" → ~5s later it pops on. Closing tagline: *"an interface for play that didn't exist a year ago."*

## Verification

- `bun run build && bun test && bun run lint` clean at every commit.
- Manual end-to-end: dress, undress, place, multi-effect turns, asset gen, cache hit on second ask of the same generated thing.
- Unit tests: `renderSpec` determinism, `SceneState` mutations, server `request_asset` triggers a generator call (mocked).
