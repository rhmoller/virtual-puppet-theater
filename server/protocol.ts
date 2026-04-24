// Wire protocol shared between the Bun server and the browser client.
// Both sides import from this file; keep it dependency-free.

export type Emotion = "neutral" | "smug" | "curious" | "excited" | "bored" | "surprised";

export type Gaze = "user" | "away" | "down" | "up";

export type Gesture = "none" | "wave" | "shrug" | "lean_in" | "nod" | "shake";

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

export type ClientEvent =
  | { type: "hello" }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "user_speaking"; speaking: boolean }
  | { type: "puppet_state"; leftVisible: boolean; rightVisible: boolean }
  | { type: "voice_list"; voices: VoiceInfo[] };

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
        enum: ["none", "wave", "shrug", "lean_in", "nod", "shake"],
      },
    },
    required: ["say", "emotion", "gaze", "gesture"],
  },
} as const;
