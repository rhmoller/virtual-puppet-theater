// Pre-fab cosmetic + scene-prop catalog. Each entry is hand-authored as
// an AssetSpec — the same parametric format the asset-generation agent
// outputs for novel requests, so the runtime renderer treats both the
// same way.
//
// Coordinate conventions
//   COSMETICS:    expressed in slot-local space. 1 unit ≈ slot-natural
//                 size (head ~1.2 units; hand ~0.4 units). The slot
//                 group on the puppet handles final scaling.
//   SCENE PROPS:  expressed in anchor-local space. Sized to look right
//                 at the anchor's distance from the camera (sky props
//                 sit far back, ground props closer).
//
// Style: friendly, slightly cartoony, saturated colors. Match the
// puppet aesthetic (StagePuppet's lavender/mustard/teal palette and
// stylized primitives). Authors prioritize silhouette readability
// over realism — these have to read on a 3-minute demo video.

import type { AssetSpec, SlotName, AnchorName } from "../../server/protocol.ts";

// ============================================================
// COSMETICS — mount on puppet slots (head / eyes / neck / hand_*).
// ============================================================

const COSMETICS: Record<string, AssetSpec> = {
  // Tall black top hat with a band.
  top_hat: {
    parts: [
      // Brim — flat wide cylinder.
      {
        shape: "cylinder",
        color: 0x111111,
        position: [0, 0.95, 0],
        rotation: [0, 0, 0],
        scale: [1.6, 0.08, 1.6],
      },
      // Crown — tall cylinder rising above the brim.
      {
        shape: "cylinder",
        color: 0x111111,
        position: [0, 1.45, 0],
        rotation: [0, 0, 0],
        scale: [1.0, 0.95, 1.0],
      },
      // Red band wrapped around the base of the crown.
      {
        shape: "cylinder",
        color: 0xc73a3a,
        position: [0, 1.05, 0],
        rotation: [0, 0, 0],
        scale: [1.05, 0.16, 1.05],
      },
    ],
  },

  // Gold five-point crown — torus base + 5 cones.
  crown: {
    parts: [
      // Band — a yellow torus around the head.
      {
        shape: "torus",
        color: 0xf2c843,
        position: [0, 0.95, 0],
        rotation: [Math.PI / 2, 0, 0],
        scale: [1.6, 1.6, 1.0],
      },
      // 5 cone points around the band.
      {
        shape: "cone",
        color: 0xf2c843,
        position: [0, 1.25, 0],
        rotation: [0, 0, 0],
        scale: [0.3, 0.6, 0.3],
      },
      {
        shape: "cone",
        color: 0xf2c843,
        position: [0.55, 1.2, 0],
        rotation: [0, 0, 0],
        scale: [0.28, 0.55, 0.28],
      },
      {
        shape: "cone",
        color: 0xf2c843,
        position: [-0.55, 1.2, 0],
        rotation: [0, 0, 0],
        scale: [0.28, 0.55, 0.28],
      },
      {
        shape: "cone",
        color: 0xf2c843,
        position: [0, 1.2, 0.55],
        rotation: [0, 0, 0],
        scale: [0.28, 0.55, 0.28],
      },
      {
        shape: "cone",
        color: 0xf2c843,
        position: [0, 1.2, -0.55],
        rotation: [0, 0, 0],
        scale: [0.28, 0.55, 0.28],
      },
    ],
  },

  // Pointy birthday-style party hat in blue with a bobble on top.
  party_hat: {
    parts: [
      {
        shape: "cone",
        color: 0x4a85d8,
        position: [0, 1.4, 0],
        rotation: [0, 0, 0],
        scale: [0.9, 1.4, 0.9],
      },
      // White bobble at the tip.
      {
        shape: "sphere",
        color: 0xfff2cf,
        position: [0, 2.15, 0],
        rotation: [0, 0, 0],
        scale: [0.3, 0.3, 0.3],
      },
    ],
  },

  // Black wraparound sunglasses — two flat cylinders sitting in front
  // of the eyes. Mounts at the `eyes` slot.
  sunglasses: {
    parts: [
      // Lenses: each centered on its corresponding eye (eyes sit at
      // upperJaw-local x = ±0.4, slot-local x = ±0.4). z = 0.25 keeps
      // the pupils behind the lens face.
      {
        shape: "cylinder",
        color: 0x111111,
        position: [-0.4, 0, 0.15],
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.75, 0.05, 0.75],
      },
      {
        shape: "cylinder",
        color: 0x111111,
        position: [0.4, 0, 0.15],
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.75, 0.05, 0.75],
      },
      // Bridge — short bar across the merged front of the lenses, since
      // the lenses now overlap heavily at center.
      {
        shape: "box",
        color: 0x111111,
        position: [0, 0, 0.20],
        rotation: [0, 0, 0],
        scale: [0.5, 0.05, 0.05],
      },
    ],
  },

  // Round wire-frame glasses — two thin tori in front of the eyes.
  round_glasses: {
    parts: [
      // Lenses: aligned with sunglasses — same positions, depth, and
      // overall outer radius. Torus default lies in the XY plane with
      // its ring axis along Z (facing the viewer); no rotation needed.
      // Scale_xy = 1.875 makes the outer ring radius 0.4 * 1.875 = 0.75
      // (matching the sunglasses cylinder radius). Scale_z = 0.4 keeps
      // the tube depth shallow.
      {
        shape: "torus_thin",
        color: 0x2a2a2a,
        position: [-0.4, 0, 0.15],
        rotation: [0, 0, 0],
        scale: [0.7, 0.7, 1.0],
      },
      {
        shape: "torus_thin",
        color: 0x2a2a2a,
        position: [0.4, 0, 0.15],
        rotation: [0, 0, 0],
        scale: [0.7, 0.7, 1.0],
      },
      {
        shape: "box",
        color: 0x2a2a2a,
        position: [0, 0, 0.20],
        rotation: [0, 0, 0],
        scale: [0.2, 0.05, 0.05],
      },
    ],
  },

  // Stick wand with a star tip — mounts at hand_left or hand_right.
  wand: {
    parts: [
      // Brown stick pointing forward.
      {
        shape: "cylinder",
        color: 0x6b4423,
        position: [0, 0, 0.4],
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.06, 0.8, 0.06],
      },
      // Yellow star tip — represented as a pointy sphere for now.
      {
        shape: "sphere",
        color: 0xf2c843,
        position: [0, 0, 0.85],
        rotation: [0, 0, 0],
        scale: [0.18, 0.18, 0.18],
      },
    ],
  },
};

// ============================================================
// SCENE PROPS — mount at theater anchors.
//
// Sky anchors are at z ~ -3.5, ground anchors at z ~ -1.8. Sizes are
// tuned for the default camera angle on those distances.
// ============================================================

const SCENE_PROPS: Record<string, AssetSpec> = {
  // Glowing pale crescent — two spheres, the second cancels the first.
  // Approximate: just a soft sphere with cool color.
  moon: {
    parts: [
      {
        shape: "sphere",
        color: 0xfff5d0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.7, 0.7, 0.7],
      },
    ],
  },

  // Bright yellow sun with a halo torus.
  sun: {
    parts: [
      {
        shape: "sphere",
        color: 0xffd23a,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.85, 0.85, 0.85],
      },
      // Corona ring (orange torus around the sphere). Sized to fit
      // within the visible sky-anchor window — original 2.4 reached
      // past the proscenium top.
      {
        shape: "torus",
        color: 0xff9326,
        position: [0, 0, -0.05],
        rotation: [0, 0, 0],
        scale: [1.5, 1.5, 0.4],
      },
    ],
  },

  // A trio of small star spheres clustered together.
  stars: {
    parts: [
      {
        shape: "sphere",
        color: 0xfff5d0,
        position: [-0.4, 0.15, 0],
        rotation: [0, 0, 0],
        scale: [0.15, 0.15, 0.15],
      },
      {
        shape: "sphere",
        color: 0xfff5d0,
        position: [0.3, -0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.18, 0.18, 0.18],
      },
      {
        shape: "sphere",
        color: 0xfff5d0,
        position: [0.0, 0.4, 0],
        rotation: [0, 0, 0],
        scale: [0.12, 0.12, 0.12],
      },
      {
        shape: "sphere",
        color: 0xfff5d0,
        position: [-0.6, -0.2, 0],
        rotation: [0, 0, 0],
        scale: [0.14, 0.14, 0.14],
      },
    ],
  },

  // Fluffy cloud — three overlapping white spheres.
  cloud: {
    parts: [
      {
        shape: "sphere",
        color: 0xf2f5fa,
        position: [-0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.6, 0.5, 0.5],
      },
      {
        shape: "sphere",
        color: 0xf2f5fa,
        position: [0.0, 0.15, 0],
        rotation: [0, 0, 0],
        scale: [0.7, 0.6, 0.6],
      },
      {
        shape: "sphere",
        color: 0xf2f5fa,
        position: [0.55, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.55, 0.45, 0.45],
      },
    ],
  },

  // Stylized tree — brown trunk + green leaf-ball on top.
  tree: {
    parts: [
      {
        shape: "cylinder",
        color: 0x6b4423,
        position: [0, 0.4, 0],
        rotation: [0, 0, 0],
        scale: [0.18, 0.8, 0.18],
      },
      {
        shape: "sphere",
        color: 0x4a8c3a,
        position: [0, 1.0, 0],
        rotation: [0, 0, 0],
        scale: [0.6, 0.7, 0.6],
      },
    ],
  },

  // Triangular silhouette — a cone reads "mountain" at distance.
  mountain: {
    parts: [
      {
        shape: "cone",
        color: 0x5a6c7a,
        position: [0, 0.6, 0],
        rotation: [0, 0, 0],
        scale: [1.4, 1.2, 1.4],
      },
      // Snowy cap.
      {
        shape: "cone",
        color: 0xf2f5fa,
        position: [0, 1.1, 0],
        rotation: [0, 0, 0],
        scale: [0.6, 0.4, 0.6],
      },
    ],
  },

  // Small green bush — three squashed spheres.
  bush: {
    parts: [
      {
        shape: "sphere",
        color: 0x3f7c2c,
        position: [-0.25, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.32, 0.4],
      },
      {
        shape: "sphere",
        color: 0x4a8c3a,
        position: [0.0, 0.18, 0],
        rotation: [0, 0, 0],
        scale: [0.45, 0.35, 0.45],
      },
      {
        shape: "sphere",
        color: 0x3f7c2c,
        position: [0.28, 0.1, 0],
        rotation: [0, 0, 0],
        scale: [0.38, 0.3, 0.38],
      },
    ],
  },

  // Beach umbrella — red dome on a stick.
  umbrella: {
    parts: [
      // Pole.
      {
        shape: "cylinder",
        color: 0xf2f5fa,
        position: [0, 0.4, 0],
        rotation: [0, 0, 0],
        scale: [0.05, 0.9, 0.05],
      },
      // Dome — half-sphere via squashed sphere.
      {
        shape: "sphere",
        color: 0xc73a3a,
        position: [0, 0.9, 0],
        rotation: [0, 0, 0],
        scale: [0.9, 0.5, 0.9],
      },
    ],
  },

  // Sand castle — three sand-colored boxes stacked, a flag on top.
  sand_castle: {
    parts: [
      {
        shape: "box",
        color: 0xe6c98a,
        position: [0, 0.3, 0],
        rotation: [0, 0, 0],
        scale: [1.2, 0.6, 1.0],
      },
      {
        shape: "box",
        color: 0xe6c98a,
        position: [-0.45, 0.75, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0.4],
      },
      {
        shape: "box",
        color: 0xe6c98a,
        position: [0.45, 0.75, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0.4],
      },
      // Flag pole on the right tower.
      {
        shape: "cylinder",
        color: 0xf2f5fa,
        position: [0.45, 1.1, 0],
        rotation: [0, 0, 0],
        scale: [0.04, 0.3, 0.04],
      },
      // Flag.
      {
        shape: "box",
        color: 0xc73a3a,
        position: [0.55, 1.18, 0],
        rotation: [0, 0, 0],
        scale: [0.16, 0.1, 0.02],
      },
    ],
  },

  // Striped beach ball — sphere with two colors approximated as one
  // base sphere + a small contrasting torus belt.
  beach_ball: {
    parts: [
      // Two-tone ball: top half red, bottom half cream, with a yellow
      // equator band so the silhouette reads as a striped ball rather
      // than a single sphere.
      {
        shape: "half_sphere",
        color: 0xc73a3a,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.9, 0.9, 0.9],
      },
      {
        shape: "half_sphere",
        color: 0xfff2cf,
        position: [0, 0, 0],
        rotation: [Math.PI, 0, 0],
        scale: [0.9, 0.9, 0.9],
      },
      {
        shape: "cylinder",
        color: 0xffd23a,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.92, 0.08, 0.92],
      },
    ],
  },

  // Tiny car — body box + cabin box + four wheel cylinders.
  car: {
    parts: [
      {
        shape: "box",
        color: 0x4a85d8,
        position: [0, 0.25, 0],
        rotation: [0, 0, 0],
        scale: [1.4, 0.4, 0.7],
      },
      {
        shape: "box",
        color: 0x4a85d8,
        position: [0, 0.55, 0],
        rotation: [0, 0, 0],
        scale: [0.8, 0.3, 0.65],
      },
      {
        shape: "cylinder",
        color: 0x111111,
        position: [-0.45, 0.05, 0.3],
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.2, 0.15, 0.2],
      },
      {
        shape: "cylinder",
        color: 0x111111,
        position: [0.45, 0.05, 0.3],
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.2, 0.15, 0.2],
      },
      {
        shape: "cylinder",
        color: 0x111111,
        position: [-0.45, 0.05, -0.3],
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.2, 0.15, 0.2],
      },
      {
        shape: "cylinder",
        color: 0x111111,
        position: [0.45, 0.05, -0.3],
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.2, 0.15, 0.2],
      },
    ],
  },

  // Wooden door — frame + slab + knob.
  door: {
    parts: [
      {
        shape: "box",
        color: 0x6b4423,
        position: [0, 0.7, 0],
        rotation: [0, 0, 0],
        scale: [0.8, 1.4, 0.1],
      },
      // Knob.
      {
        shape: "sphere",
        color: 0xf2c843,
        position: [0.25, 0.7, 0.06],
        rotation: [0, 0, 0],
        scale: [0.08, 0.08, 0.08],
      },
    ],
  },

  // Window — light-blue pane + cross frame.
  window: {
    parts: [
      {
        shape: "box",
        color: 0xa8d8e8,
        position: [0, 0.6, 0],
        rotation: [0, 0, 0],
        scale: [0.9, 0.9, 0.05],
      },
      // Vertical mullion.
      {
        shape: "box",
        color: 0xf2f5fa,
        position: [0, 0.6, 0.03],
        rotation: [0, 0, 0],
        scale: [0.06, 0.9, 0.04],
      },
      // Horizontal mullion.
      {
        shape: "box",
        color: 0xf2f5fa,
        position: [0, 0.6, 0.03],
        rotation: [0, 0, 0],
        scale: [0.9, 0.06, 0.04],
      },
    ],
  },
};

// ============================================================
// Public lookup helpers + name lists for the system prompt.
// ============================================================

export const COSMETIC_NAMES = Object.keys(COSMETICS) as readonly string[];
export const SCENE_PROP_NAMES = Object.keys(SCENE_PROPS) as readonly string[];

export function getCosmetic(name: string): AssetSpec | null {
  return COSMETICS[name] ?? null;
}

export function getSceneProp(name: string): AssetSpec | null {
  return SCENE_PROPS[name] ?? null;
}

// Named slots/anchors re-exported as runtime arrays for prompt
// composition. The protocol's TS types are erased at runtime.
export const SLOT_NAMES: readonly SlotName[] = [
  "head",
  "eyes",
  "neck",
  "hand_left",
  "hand_right",
];
export const ANCHOR_NAMES: readonly AnchorName[] = [
  "sky_left",
  "sky_center",
  "sky_right",
  "ground_left",
  "ground_center",
  "ground_right",
  "far_back",
];
