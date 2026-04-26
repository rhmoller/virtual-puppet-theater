// SceneController — applies Effect[] from the LLM to the THREE scene.
//
// Translates the protocol's scene-direction vocabulary (dress, place,
// request_*) into actual mounted/dismounted Groups on the puppet rigs
// and theater anchors. Owns no scene state itself; SceneState is the
// source of truth, and slot/anchor groups are looked up via injected
// getters each time.
//
// Mount transitions are cross-faded: outgoing asset fades out (scale
// 1→0 + opacity 1→0) while the incoming fades in (scale 0→1 + opacity
// 0→1). Animation state lives in a Map keyed by wrapper Group so that
// rapid re-mounts cancel cleanly. The frame loop drives all live
// animations via update(dt).

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

const FADE_IN_DURATION = 0.35;
const FADE_OUT_DURATION = 0.2;

type FadeAnim = {
  wrapper: THREE.Group;
  meshes: THREE.Mesh[];
  mode: "in" | "out";
  t: number;
  duration: number;
};

export class SceneController {
  // Active animations keyed by wrapper so a fresh mount on a
  // currently-fading wrapper cancels the old animation and replaces it.
  private animations = new Map<THREE.Group, FadeAnim>();

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
          // Nothing to render yet — the puppet's stall line covers the wait.
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

  /** Per-frame tick — drives all live mount/unmount fades. */
  update(dt: number): void {
    if (this.animations.size === 0) return;
    const finished: THREE.Group[] = [];
    for (const [wrapper, anim] of this.animations) {
      anim.t += dt;
      const p = Math.min(1, anim.t / anim.duration);
      // Ease-out for fade-in (snappy entrance), ease-in for fade-out
      // (slow start, fast finish — feels like the asset is dissolving).
      const v = anim.mode === "in" ? easeOutCubic(p) : 1 - easeInCubic(p);
      wrapper.scale.setScalar(v);
      for (const m of anim.meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.opacity = v;
      }
      if (p >= 1) finished.push(wrapper);
    }
    for (const wrapper of finished) {
      const anim = this.animations.get(wrapper);
      if (!anim) continue;
      this.animations.delete(wrapper);
      if (anim.mode === "out") {
        // Remove from parent and dispose freed materials.
        const parent = wrapper.parent;
        if (parent) parent.remove(wrapper);
        for (const m of anim.meshes) {
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
          else mat.dispose();
        }
      }
    }
  }

  // ---- internals ----

  private mountAtSlot(puppet: PuppetId, slot: SlotName, asset: string | null): void {
    const group = this.slotFor(puppet, slot);
    if (!group) {
      console.warn(`[scene] no slot group for ${puppet}.${slot}`);
      return;
    }
    if (asset === null) {
      this.fadeOutAll(group);
      return;
    }
    const spec = this.state.resolveAsset(asset);
    if (!spec) {
      console.warn(`[scene] unknown asset name: ${asset}`);
      return; // leave existing content alone — don't clear on a typo
    }
    this.fadeOutAll(group);
    this.fadeInNew(group, spec);
  }

  private mountAtAnchor(anchor: AnchorName, asset: string | null): void {
    const group = this.anchorFor(anchor);
    if (!group) {
      console.warn(`[scene] no anchor group for ${anchor}`);
      return;
    }
    if (asset === null) {
      this.fadeOutAll(group);
      return;
    }
    const spec = this.state.resolveAsset(asset);
    if (!spec) {
      console.warn(`[scene] unknown asset name: ${asset}`);
      return;
    }
    this.fadeOutAll(group);
    this.fadeInNew(group, spec);
  }

  /** Begin fading every wrapper child of `group` out. Idempotent: if a
   *  wrapper is already fading out, leave its animation alone; if it's
   *  fading in, swap to fade-out from current scale. */
  private fadeOutAll(group: THREE.Group): void {
    for (const child of group.children.slice()) {
      if (!(child instanceof THREE.Group)) {
        // Defensive: legacy non-wrapper child (shouldn't happen). Just
        // remove it without animation.
        group.remove(child);
        continue;
      }
      const existing = this.animations.get(child);
      if (existing && existing.mode === "out") continue; // already on its way
      const meshes = existing?.meshes ?? collectMeshes(child);
      // Carry over current scale so a mid-fade-in cleanly reverses.
      const carryT = existing
        ? existing.mode === "in"
          ? FADE_OUT_DURATION * (1 - existing.t / existing.duration)
          : 0
        : 0;
      this.animations.set(child, {
        wrapper: child,
        meshes,
        mode: "out",
        t: carryT,
        duration: FADE_OUT_DURATION,
      });
    }
  }

  /** Wrap the rendered asset in a Group, add it to `parent`, and queue
   *  a fade-in animation. */
  private fadeInNew(parent: THREE.Group, spec: AssetSpec): void {
    const wrapper = new THREE.Group();
    wrapper.scale.setScalar(0);
    const rendered = renderSpec(spec);
    const meshes = collectMeshes(rendered);
    for (const m of meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = 0;
    }
    wrapper.add(rendered);
    parent.add(wrapper);
    this.animations.set(wrapper, {
      wrapper,
      meshes,
      mode: "in",
      t: 0,
      duration: FADE_IN_DURATION,
    });
  }
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function easeInCubic(t: number): number {
  return t * t * t;
}
