// Wire protocol shared between the Bun server and the browser client.
// Both sides import from this file; keep it dependency-free.

export type Emotion = "neutral" | "smug" | "curious" | "excited" | "bored" | "surprised";

export type Gaze = "user" | "away" | "down" | "up";

export type Gesture =
  | "none"
  | "wave"
  | "shrug"
  | "lean_in"
  | "nod"
  | "shake"
  | "jump"
  | "spin"
  | "wiggle"
  | "raise_hands"
  | "swing_hands";

export type Action = {
  say?: string;
  emotion?: Emotion;
  gaze?: Gaze;
  gesture?: Gesture;
  // Optional scene-direction effects. Strict structured output requires
  // an array (possibly empty) so the field is always present on the wire,
  // but in-process construction of an Action can omit it.
  effects?: Effect[];
};

export type VoiceInfo = {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
};

// ---- User-side body-language signals ----
//
// One-shot gestures detected client-side from MediaPipe landmarks.
// Flat list — no hand attribution. The LLM rarely needs to know which
// hand waved, and a flat list keeps the prompt tight.
export type UserGesture =
  | "thumbs_up"
  | "peace"
  | "fist"
  | "open_palm"
  | "point"
  | "wave"
  | "jump";

// Sustained postural state of the "active" user puppet. Single pose
// (not per-hand). Active = the visible puppet with the highest recent
// palm motion; if only one is visible, that one; if none, no pose is
// reported.
export type UserPose = "normal" | "upside_down" | "sleeping";

// Embodied energy hint derived from the gesture buffer + presence.
// Independent of text-based mood, which the server reads from the
// transcript itself.
export type UserEnergy = "low" | "med" | "high";

// Brain size selector — picks which Claude model the puppet runs on.
// Communicated via the WebSocket URL query string (?brain=large|small)
// rather than a client event, since the server needs the choice when
// constructing the session (the opening line fires immediately).
export type BrainSize = "large" | "small";

// ---- Scene effects (Claude as scene director) ----

// Cosmetic slots on a puppet rig. Each slot is a THREE.Group parented
// to a stable anchor on the puppet (head, body, hand) so that the
// slot's contents inherit gestures and idle motion automatically.
export type SlotName = "head" | "eyes" | "neck" | "hand_left" | "hand_right";

// Named regions in the theater where scene props can be placed. The
// proscenium and curtains stay; locations are evoked by a few iconic
// props (moon at sky_right, sand_castle at ground_center, etc).
export type AnchorName =
  | "sky_left"
  | "sky_center"
  | "sky_right"
  | "ground_left"
  | "ground_center"
  | "ground_right"
  | "far_back";

// Which puppet a `dress` effect targets. "user" is the hand-controlled
// puppet; "ai" is the StagePuppet.
export type PuppetId = "user" | "ai";

// Parametric description of any visual asset — pre-fab or generated.
// Composed entirely of THREE primitives so the same renderer handles
// hand-authored catalog items and on-the-fly LLM-designed assets.
//
// `color` accepts either a hex string ("#ff8800" or "ff8800" — the
// LLM-friendly form) or a packed integer (0xff8800 — convenient for
// hand-authored catalog literals). The renderer parses both.
export type AssetShape =
  | "sphere"
  | "box"
  | "cone"
  | "cylinder"
  | "torus"
  | "half_sphere"
  | "capsule"
  | "star"
  | "heart"
  | "slice"
  | "lathe"
  | "extrude";
export type AssetColor = string | number;
export type AssetSpec = {
  parts: Array<{
    shape: AssetShape;
    color: AssetColor;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    // extrude: a list of 3D control points the path passes through.
    // Coordinates are part-local (the part's `position` then offsets the
    // whole curve into slot-local space). Smooth Catmull-Rom interpolation
    // is applied between points; 3–6 points is typical.
    path?: ReadonlyArray<readonly [number, number, number]>;
    // Render the part with reduced opacity (~0.5). For glass / water / ice /
    // ghosts. Most parts should leave this unset.
    transparent?: boolean;
    // slice only: sweep angle in radians (default π/3 = 60° = 1/6 of a pie).
    // Common values: π/4 (45°, 1/8 pie), π/3 (60°, 1/6 pie), π/2 (90°, quarter).
    sweep?: number;
    // lathe + extrude: a 2D silhouette/cross-section. `points` is a list
    // of [x, y] pairs forming a closed loop (last → first auto-closed).
    // For lathe: x is the radial distance from the Y axis (≥ 0); y is the
    //   height. Contour shapes the silhouette of a rotationally symmetric
    //   solid (vase, bottle, dome, gem).
    // For extrude: the contour is the cross-section perpendicular to the
    //   sweep path. Centered around the part's local origin in 2D.
    // `smooth: true` interpolates between points with a Catmull-Rom
    //   curve for organic silhouettes; `false` connects with straight
    //   line segments for faceted shapes.
    contour?: {
      points: ReadonlyArray<readonly [number, number]>;
      // Optional inner perimeters that subtract from the outer to form
      // holes. Each hole is a closed loop. Use for archways with a
      // passage (outer wall + inner arch hole), donuts viewed face-on,
      // window frames, picture frames, any silhouette with a cutout.
      holes?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
      smooth?: boolean;
    };
    // lathe only: sweep angle of revolution in radians (default 2π).
    // Use < 2π for partial revolutions (a half-dome at π, a quarter at π/2).
    lathe_sweep?: number;
    // extrude only: cross-section scale at evenly-spaced positions along
    // the path. Linear interpolation between values. Default [1, 1] = no
    // taper. [1, 0] = cone (full to point). [0.3, 1.0, 0.3] = banana
    // (thin at both ends, thick in middle). Any length ≥ 2.
    taper?: ReadonlyArray<number>;
    // extrude only: cap style at the start (path[0]) of the extrude.
    // - "flat" (default): triangulated 2D cap perpendicular to the path.
    // - "pointy": closes to a single apex point along the outward
    //     direction at distance ≈ contour radius (cone-like tip).
    // - "rounded": hemispherical cap (banana tip, snake-tail blunt-round).
    // - "none": leaves the end open (visible hollow ring if seen end-on).
    cap_start?: "flat" | "pointy" | "rounded" | "none";
    // extrude only: cap style at the end (path[N-1]). Same options as
    // cap_start.
    cap_end?: "flat" | "pointy" | "rounded" | "none";
  }>;
};

// Operations Claude can emit to direct the scene. Layered on top of
// the speech / emotion / gaze / gesture embodiment fields, so a single
// turn can both speak and rearrange the stage.
//
// One flat shape with all fields nullable (rather than a discriminated
// union) because Anthropic's structured-output engine doesn't support
// `oneOf`. Consumers narrow on `op` and runtime-check the fields
// expected for that op.
//
// Fields by op:
//   "dress"             → puppet, slot, asset (asset null = remove).
//   "place"             → anchor, asset (asset null = clear anchor).
//   "request_cosmetic"  → puppet, slot, description, request_id.
//   "request_prop"      → anchor, description, request_id.
//   "clear"             → no fields. Wipes all cosmetics + scene props.
//   "recolor"           → puppet, slot (= channel "skin"|"shirt"|"hair"), color.
export type EffectOp =
  | "dress"
  | "place"
  | "request_cosmetic"
  | "request_prop"
  | "clear"
  | "recolor";
export type Effect = {
  op: EffectOp;
  puppet?: PuppetId | null;
  slot?: SlotName | null;
  anchor?: AnchorName | null;
  asset?: string | null;
  description?: string | null;
  request_id?: string | null;
  color?: string | null;
};

export type ClientEvent =
  | { type: "hello" }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "user_speaking"; speaking: boolean }
  | { type: "puppet_state"; visible: boolean }
  | { type: "voice_list"; voices: VoiceInfo[] }
  // Streamed body-language updates. Each field is optional — the client
  // sends only what changed since the last signal. The server buffers
  // gestures (drained on each LLM turn) and tracks the latest pose /
  // energy (sticky). Both transcript-final turns and idle escalations
  // snapshot this state when composing their LLM call.
  | {
      type: "signal";
      gestures?: UserGesture[];
      pose?: UserPose;
      energy?: UserEnergy;
    };

export type ServerEvent =
  | { type: "action"; action: Action }
  | { type: "cancel_speech" }
  | { type: "error"; message: string }
  | { type: "voice_pick"; voiceURI: string }
  // Pushed when a parallel asset-design agent finishes composing an
  // asset requested earlier via Effect.request_asset. The client mounts
  // the spec at the slot/anchor it remembered against the request_id.
  | {
      type: "asset_ready";
      request_id: string;
      asset_name: string;
      spec: AssetSpec;
    };

// Shape enum for the asset-spec schema. Slot / anchor / puppet enums
// are NOT enforced in the wire schema (strict mode + flat-object effects
// requires nullable fields, which fights enum constraints); the system
// prompt tells the LLM the allowed values, and the server validates by
// looking up the slot/anchor at runtime.
const SHAPES = [
  "sphere",
  "box",
  "cone",
  "cylinder",
  "torus",
  "half_sphere",
  "capsule",
  "star",
  "heart",
  "slice",
  "lathe",
  "extrude",
] as const;

// Anthropic's structured-output schema engine doesn't support `oneOf`,
// so the effect item is a single flat object with all possible fields
// always present. Fields that don't apply to the chosen `op` should be
// null. The server validates per-op which fields it consumes; the
// system prompt tells Claude which combinations are valid.
const EFFECT_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    op: {
      type: "string",
      enum: ["dress", "place", "request_cosmetic", "request_prop", "clear", "recolor"],
    },
    puppet: {
      type: ["string", "null"],
      description:
        'Required for op="dress" and op="request_cosmetic". One of: "user", "ai". null otherwise.',
    },
    slot: {
      type: ["string", "null"],
      description:
        'Required for op="dress" and op="request_cosmetic" — one of: "head", "eyes", "neck", "hand_left", "hand_right". For op="recolor", repurposed as the channel — one of: "skin", "shirt", "hair". null otherwise.',
    },
    anchor: {
      type: ["string", "null"],
      description:
        'Required for op="place" and op="request_prop". One of: "sky_left", "sky_center", "sky_right", "ground_left", "ground_center", "ground_right", "far_back". null otherwise.',
    },
    asset: {
      type: ["string", "null"],
      description:
        'Required for op="dress" and op="place" — the catalog asset name (or null to remove/clear). null for the request_* ops.',
    },
    description: {
      type: ["string", "null"],
      description:
        'Required for op="request_cosmetic" and op="request_prop" — short vivid description of the asset to design (e.g., "a watermelon hat"). null otherwise.',
    },
    request_id: {
      type: ["string", "null"],
      description:
        'Required for op="request_*" — short unique id (e.g. "r1") to match up the resulting asset. null otherwise.',
    },
    color: {
      type: ["string", "null"],
      description:
        'Required for op="recolor" — a CSS color name ("red", "skyblue") or hex string ("#ff8800"). null otherwise.',
    },
  },
  required: ["op", "puppet", "slot", "anchor", "asset", "description", "request_id", "color"],
} as const;

export const ACTION_JSON_SCHEMA = {
  name: "puppet_action",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      say: {
        type: "string",
        description: "What the puppet says aloud. Keep it short — one or two sentences.",
      },
      emotion: {
        type: "string",
        enum: ["neutral", "smug", "curious", "excited", "bored", "surprised"],
      },
      gaze: { type: "string", enum: ["user", "away", "down", "up"] },
      gesture: {
        type: "string",
        enum: [
          "none",
          "wave",
          "shrug",
          "lean_in",
          "nod",
          "shake",
          "jump",
          "spin",
          "wiggle",
          "raise_hands",
          "swing_hands",
        ],
      },
      effects: {
        type: "array",
        description:
          "Scene-direction effects to apply this turn. Empty array if you're just talking and not changing the stage.",
        items: EFFECT_ITEM_SCHEMA,
      },
    },
    required: ["say", "emotion", "gaze", "gesture", "effects"],
  },
} as const;

// Schema for the parallel asset-design agent's output. The agent
// returns an AssetSpec and nothing else.
//
// Note: Anthropic structured output rejects `minItems`/`maxItems` > 1
// on arrays, so position/rotation/scale can't be enforced as 3-tuples
// at the schema level. The renderer (src/assets/render.ts) coerces
// each to length 3 with sensible defaults at runtime.
export const ASSET_SPEC_JSON_SCHEMA = {
  name: "asset_spec",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      parts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            shape: { type: "string", enum: [...SHAPES] },
            color: {
              type: "string",
              description:
                'Hex RGB color string with six hex digits, optional leading "#". Examples: "#ff8800" (orange), "#4caf50" (green), "#2a2a2a" (near-black).',
            },
            position: {
              type: "array",
              description: "Exactly 3 numbers: [x, y, z] in slot/anchor-local space.",
              items: { type: "number" },
            },
            rotation: {
              type: "array",
              description: "Exactly 3 numbers: [rx, ry, rz] in radians.",
              items: { type: "number" },
            },
            scale: {
              type: "array",
              description: "Exactly 3 numbers: [sx, sy, sz] as multipliers on a unit primitive.",
              items: { type: "number" },
            },
            path: {
              type: ["array", "null"],
              description:
                'Required for shape="extrude". Each element is [x,y,z] in part-local space. 3-6 control points; the curve passes smoothly through them. null for all other shapes.',
              items: {
                type: "array",
                items: { type: "number" },
              },
            },
            transparent: {
              type: ["boolean", "null"],
              description:
                'Set true to render the part at ~50% opacity, suggesting glass / water / ice / ghost. null or false for solid.',
            },
            sweep: {
              type: ["number", "null"],
              description:
                'Sweep angle in radians for shape="slice" (default π/3 ≈ 1.047 = 60° = 1/6 of a pie). Common: 0.785 (45°/eighth), 1.047 (60°/sixth), 1.571 (90°/quarter). null for all other shapes.',
            },
            contour: {
              type: ["object", "null"],
              description:
                'Required for shape="lathe" and shape="extrude". 2D silhouette. For lathe, points are (radial distance ≥ 0, height) revolved around the Y axis. For extrude, points are the cross-section in the plane perpendicular to the sweep path. Optional `holes` is a list of inner perimeters that subtract from the outer — use for archways, donut cross-sections, frames.',
              properties: {
                points: {
                  type: "array",
                  items: { type: "array", items: { type: "number" } },
                },
                holes: {
                  type: ["array", "null"],
                  items: {
                    type: "array",
                    items: { type: "array", items: { type: "number" } },
                  },
                },
                smooth: { type: "boolean" },
              },
              required: ["points", "holes", "smooth"],
              additionalProperties: false,
            },
            lathe_sweep: {
              type: ["number", "null"],
              description:
                'Required for shape="lathe". Angle of revolution in radians. 2π ≈ 6.283 for a full revolution (most common), π for a half-dome, π/2 for a quarter.',
            },
            taper: {
              type: ["array", "null"],
              description:
                'Required for shape="extrude". Cross-section scale at evenly-spaced positions along the path. [1,1] = no taper. [1,0] = cone (point at the end). [0.3, 1.0, 0.3] = fat middle, thin ends (banana). Any length ≥ 2; values linearly interpolated.',
              items: { type: "number" },
            },
            cap_start: {
              type: ["string", "null"],
              description:
                'Cap style at path[0] for shape="extrude". One of: "flat" (triangulated, perpendicular to tangent), "pointy" (cone-shaped apex), "rounded" (hemispherical bulge), "none" (open end). Defaults to "flat" if null. null for all other shapes.',
            },
            cap_end: {
              type: ["string", "null"],
              description:
                'Cap style at path[N-1] for shape="extrude". One of: "flat", "pointy", "rounded", "none". Same options as cap_start. null for all other shapes.',
            },
          },
          required: [
            "shape",
            "color",
            "position",
            "rotation",
            "scale",
            "path",
            "transparent",
            "sweep",
            "contour",
            "lathe_sweep",
            "taper",
            "cap_start",
            "cap_end",
          ],
        },
      },
    },
    required: ["parts"],
  },
} as const;
