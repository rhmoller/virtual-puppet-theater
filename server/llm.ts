import Anthropic from "@anthropic-ai/sdk";
import { ACTION_JSON_SCHEMA, type Action, type VoiceInfo } from "./protocol.ts";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export interface LLMBackend {
  name: string;
  generateAction(messages: ChatMessage[]): Promise<Action>;
  pickVoice(voices: VoiceInfo[]): Promise<string | null>;
}

const MODEL = "claude-opus-4-7";

const VOICE_PICK_SYSTEM = `You pick browser SpeechSynthesis voices for character TTS. Output JSON only, matching the given schema.`;

const VOICE_PICK_SCHEMA = {
  name: "voice_pick",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      voiceURI: {
        type: "string",
        description: "Exact voiceURI from the provided list, or empty string if none fit.",
      },
    },
    required: ["voiceURI"],
  },
} as const;

export class AnthropicBackend implements LLMBackend {
  name = `anthropic-${MODEL}`;
  private client = new Anthropic();

  async generateAction(messages: ChatMessage[]): Promise<Action> {
    const systemParts: string[] = [];
    const turns: Anthropic.MessageParam[] = [];
    for (const m of messages) {
      if (m.role === "system") systemParts.push(m.content);
      else turns.push({ role: m.role, content: m.content });
    }

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 600,
      // System prompt + conversation prefix are stable across turns, so
      // enabling prompt caching lets subsequent calls reuse the cached
      // prefix (cheaper reads, lower TTFT) once the prefix is long
      // enough — Opus 4.7 requires ≥ 4096 cacheable tokens to kick in.
      cache_control: { type: "ephemeral" },
      system: systemParts.join("\n\n"),
      messages: turns,
      output_config: {
        // low effort: short, structured reply, no heavy reasoning needed.
        effort: "low",
        format: { type: "json_schema", schema: ACTION_JSON_SCHEMA.schema },
      },
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error(`Anthropic returned no text block: ${JSON.stringify(response.content)}`);
    }
    const obj = JSON.parse(textBlock.text);
    return {
      say: typeof obj.say === "string" ? obj.say : undefined,
      emotion: obj.emotion,
      gaze: obj.gaze,
      gesture: obj.gesture,
    };
  }

  async pickVoice(voices: VoiceInfo[]): Promise<string | null> {
    if (voices.length === 0) return null;
    // Cap the list: browsers with 100+ voices blow token count for no gain.
    const list = voices.slice(0, 60);
    const table = list
      .map(
        (v, i) =>
          `${i}. ${JSON.stringify(v.name)} lang=${v.lang} local=${v.localService} uri=${JSON.stringify(v.voiceURI)}`,
      )
      .join("\n");

    const prompt = `Pick the best voice for Clawd, a cheerful, goofy male sock-puppet speaking English to young kids. The voice should sound:
- Clearly male, warm, friendly, a little playful
- English (en-*), any dialect
- Clear and pleasant for kids — not robotic, not monotone, not sinister

Reject voices that sound female, non-English, or obviously synthetic/harsh.
Return the exact voiceURI string from the list below (copy it verbatim).
If no voice fits, return an empty string.

Voices:
${table}`;

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: VOICE_PICK_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: VOICE_PICK_SCHEMA.schema },
      },
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    try {
      const parsed = JSON.parse(textBlock.text) as { voiceURI?: unknown };
      if (typeof parsed.voiceURI !== "string" || parsed.voiceURI.length === 0) return null;
      // Verify it actually exists in the list — belt and braces.
      return list.some((v) => v.voiceURI === parsed.voiceURI) ? parsed.voiceURI : null;
    } catch {
      return null;
    }
  }
}
