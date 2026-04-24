import Anthropic from "@anthropic-ai/sdk";
import { ACTION_JSON_SCHEMA, type Action } from "./protocol.ts";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export interface LLMBackend {
  name: string;
  generateAction(messages: ChatMessage[]): Promise<Action>;
}

const MODEL = "claude-opus-4-7";

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
}
