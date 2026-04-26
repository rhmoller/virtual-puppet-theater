// Pure state for the directed scene — what each puppet is wearing,
// what's at each anchor, what generated assets exist, and which
// generations are still in flight.
//
// Lives both client-side (this file) and server-side (mirrored in
// server/session.ts) so the LLM prompt can include "currently dressed:
// ..." and avoid re-issuing dress effects every turn or contradicting
// the visible scene.
//
// No THREE refs here — the SceneController owns the rendering side.

import type {
  AnchorName,
  AssetSpec,
  Effect,
  PuppetId,
  SlotName,
} from "../server/protocol.ts";
import { getCosmetic, getSceneProp } from "./assets/catalog";

type WornMap = Partial<Record<SlotName, string>>;

type PendingRequest =
  | {
      kind: "cosmetic";
      puppet: PuppetId;
      slot: SlotName;
      description: string;
    }
  | {
      kind: "prop";
      anchor: AnchorName;
      description: string;
    };

export class SceneState {
  // Per-puppet cosmetic slot occupancy.
  private worn: Record<PuppetId, WornMap> = {
    user: {},
    ai: {},
  };
  // Per-anchor scene prop occupancy.
  private placed: Partial<Record<AnchorName, string>> = {};
  // Generated AssetSpecs keyed by asset name. Live alongside the
  // catalog — `resolveAsset` checks here first.
  private generated = new Map<string, AssetSpec>();
  // request_id -> the slot/anchor we're waiting to fill.
  private pending = new Map<string, PendingRequest>();

  /** Looks up an asset spec by name. Generated assets shadow the
   *  pre-fab catalog if names collide. Returns null if neither has it. */
  resolveAsset(name: string): AssetSpec | null {
    return this.generated.get(name) ?? getCosmetic(name) ?? getSceneProp(name) ?? null;
  }

  /** Records a dress effect's outcome. Returns the previously-worn
   *  asset at that slot (for diagnostics / undo, currently unused). */
  dress(puppet: PuppetId, slot: SlotName, asset: string | null): string | null {
    const prev = this.worn[puppet][slot] ?? null;
    if (asset === null) delete this.worn[puppet][slot];
    else this.worn[puppet][slot] = asset;
    return prev;
  }

  place(anchor: AnchorName, asset: string | null): string | null {
    const prev = this.placed[anchor] ?? null;
    if (asset === null) delete this.placed[anchor];
    else this.placed[anchor] = asset;
    return prev;
  }

  recordPending(request_id: string, req: PendingRequest): void {
    this.pending.set(request_id, req);
  }

  consumePending(request_id: string): PendingRequest | null {
    const req = this.pending.get(request_id);
    if (!req) return null;
    this.pending.delete(request_id);
    return req;
  }

  registerGenerated(name: string, spec: AssetSpec): void {
    this.generated.set(name, spec);
  }

  /** Reads the current worn assets for a puppet. */
  wornBy(puppet: PuppetId): Readonly<WornMap> {
    return this.worn[puppet];
  }

  /** Reads the current placed asset at an anchor. */
  at(anchor: AnchorName): string | null {
    return this.placed[anchor] ?? null;
  }

  /** Compact human-readable summary used in LLM prompts. */
  describe(): string {
    const parts: string[] = [];
    for (const p of ["user", "ai"] as const) {
      const w = this.worn[p];
      const items = Object.entries(w)
        .map(([slot, asset]) => `${slot}=${asset}`)
        .join(",");
      if (items.length > 0) parts.push(`${p}{${items}}`);
    }
    const placedEntries = Object.entries(this.placed);
    if (placedEntries.length > 0) {
      parts.push(
        `placed{${placedEntries.map(([a, n]) => `${a}=${n}`).join(",")}}`,
      );
    }
    return parts.length > 0 ? parts.join(" ") : "empty";
  }
}

/** Apply a single dress/place effect to local state without rendering.
 *  Used by both client (before SceneController renders) and server
 *  (which has no renderer). Silently drops effects with missing
 *  required fields — the wire shape is flat, so the LLM may emit
 *  an op with the wrong fields populated. */
export function applyStateEffect(state: SceneState, effect: Effect): void {
  switch (effect.op) {
    case "dress":
      if (!effect.puppet || !effect.slot) return;
      state.dress(effect.puppet, effect.slot, effect.asset ?? null);
      return;
    case "place":
      if (!effect.anchor) return;
      state.place(effect.anchor, effect.asset ?? null);
      return;
    case "request_cosmetic":
      if (!effect.puppet || !effect.slot || !effect.description || !effect.request_id) return;
      state.recordPending(effect.request_id, {
        kind: "cosmetic",
        puppet: effect.puppet,
        slot: effect.slot,
        description: effect.description,
      });
      return;
    case "request_prop":
      if (!effect.anchor || !effect.description || !effect.request_id) return;
      state.recordPending(effect.request_id, {
        kind: "prop",
        anchor: effect.anchor,
        description: effect.description,
      });
      return;
  }
}
