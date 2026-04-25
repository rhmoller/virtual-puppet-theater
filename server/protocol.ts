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
  | "wiggle";

export type Action = {
  say?: string;
  emotion?: Emotion;
  gaze?: Gaze;
  gesture?: Gesture;
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

export type ClientEvent =
  | { type: "hello" }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "user_speaking"; speaking: boolean }
  | { type: "puppet_state"; leftVisible: boolean; rightVisible: boolean }
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
  | { type: "voice_pick"; voiceURI: string };

export const ACTION_JSON_SCHEMA = {
  name: "clawd_action",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      say: {
        type: "string",
        description: "What Clawd says aloud. Keep it short — one or two sentences.",
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
        ],
      },
    },
    required: ["say", "emotion", "gaze", "gesture"],
  },
} as const;
