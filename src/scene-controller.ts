// SceneController — applies Effect[] from the LLM to the THREE scene.
//
// Translates the protocol's scene-direction vocabulary (dress, place,
// request_*) into actual mounted/dismounted Groups on the puppet rigs
// and theater anchors. Owns no state itself; SceneState is the source
// of truth, and slot/anchor groups are looked up via injected getters
// each time so the controller doesn't have to hold THREE refs.

import * as THREE from "three";
import type {
  AnchorName,
  AssetSpec,
  Effect,
  PuppetId,
  SlotName,
} from "../server/protocol.ts";
import { renderSpec } from "./assets/render";
import { SceneState, applyStateEffect } from "./scene-state";

export type SlotResolver = (puppet: PuppetId, slot: SlotName) => THREE.Group | null;
export type AnchorResolver = (anchor: AnchorName) => THREE.Group | null;

export class SceneController {
  constructor(
    private state: SceneState,
    private slotFor: SlotResolver,
    private anchorFor: AnchorResolver,
  ) {}

  /** Apply the LLM's effects array. State updates mirror the renders.
   *  Silently drops effects whose required fields are null — the
   *  flat wire shape lets the LLM emit nonsense like dress with no
   *  puppet, and applyStateEffect already skips those. */
  applyEffects(effects: ReadonlyArray<Effect>): void {
    for (const e of effects) {
      applyStateEffect(this.state, e);
      switch (e.op) {
        case "dress":
          if (e.puppet && e.slot) this.mountAtSlot(e.puppet, e.slot, e.asset ?? null);
          break;
        case "place":
          if (e.anchor) this.mountAtAnchor(e.anchor, e.asset ?? null);
          break;
        case "request_cosmetic":
        case "request_prop":
          // Nothing to render yet — Clawd's stall line covers the wait.
          // The asset_ready event will arrive separately.
          break;
      }
    }
  }

  /** Called when an asset_ready ServerEvent lands. The matching pending
   *  request tells us where to mount it. */
  registerGenerated(request_id: string, asset_name: string, spec: AssetSpec): void {
    this.state.registerGenerated(asset_name, spec);
    const pending = this.state.consumePending(request_id);
    if (!pending) {
      // No matching request — most likely the session reset between
      // request and ready. Drop it; the asset is in the registry if
      // anyone asks for it by name later.
      console.warn("[scene] asset_ready for unknown request:", request_id);
      return;
    }
    if (pending.kind === "cosmetic") {
      this.state.dress(pending.puppet, pending.slot, asset_name);
      this.mountAtSlot(pending.puppet, pending.slot, asset_name);
    } else {
      this.state.place(pending.anchor, asset_name);
      this.mountAtAnchor(pending.anchor, asset_name);
    }
  }

  // ---- internals ----

  private mountAtSlot(puppet: PuppetId, slot: SlotName, asset: string | null): void {
    const group = this.slotFor(puppet, slot);
    if (!group) {
      console.warn(`[scene] no slot group for ${puppet}.${slot}`);
      return;
    }
    clearChildren(group);
    if (asset === null) return;
    const spec = this.state.resolveAsset(asset);
    if (!spec) {
      console.warn(`[scene] unknown asset name: ${asset}`);
      return;
    }
    group.add(renderSpec(spec));
  }

  private mountAtAnchor(anchor: AnchorName, asset: string | null): void {
    const group = this.anchorFor(anchor);
    if (!group) {
      console.warn(`[scene] no anchor group for ${anchor}`);
      return;
    }
    clearChildren(group);
    if (asset === null) return;
    const spec = this.state.resolveAsset(asset);
    if (!spec) {
      console.warn(`[scene] unknown asset name: ${asset}`);
      return;
    }
    group.add(renderSpec(spec));
  }
}

function clearChildren(group: THREE.Group): void {
  for (const child of group.children.slice()) {
    group.remove(child);
    // Dispose geometries/materials to keep WebGL memory bounded if the
    // user dresses+undresses many times. Geometry instances are shared
    // across asset specs, so we only dispose materials (newly created
    // per-render).
    if ((child as THREE.Mesh).material) {
      const m = (child as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else m.dispose();
    } else {
      // Group child — recurse to dispose its descendants' materials.
      child.traverse((d) => {
        const dm = (d as THREE.Mesh).material;
        if (!dm) return;
        if (Array.isArray(dm)) dm.forEach((mm) => mm.dispose());
        else dm.dispose();
      });
    }
  }
}
