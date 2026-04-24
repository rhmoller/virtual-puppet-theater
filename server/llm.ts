import { ACTION_JSON_SCHEMA, type Action } from "./protocol.ts";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export interface LLMBackend {
  name: string;
  generateAction(messages: ChatMessage[]): Promise<Action>;
}

const SCHEMA_HINT = `Respond with a SINGLE JSON object matching this shape:
{
  "say": "<one or two short sentences Clawd says aloud>",
  "emotion": "neutral|smug|curious|excited|bored|surprised",
  "gaze": "user|away|down|up",
  "gesture": "none|wave|shrug|lean_in|nod|shake"
}
Return only the JSON object — no prose, no markdown fences, no reasoning. /no_think`;

export class LMStudioBackend implements LLMBackend {
  name = "lm-studio";
  private mode: "json_schema" | "json_object" | "none" = "json_schema";

  constructor(
    private baseUrl = process.env.LM_STUDIO_URL ?? "http://localhost:1234/v1",
    private model = process.env.LM_STUDIO_MODEL ?? "qwen/qwen3.6-35b-a3b",
  ) {}

  async generateAction(messages: ChatMessage[]): Promise<Action> {
    // Always reinforce the schema in-band — cheapest guardrail for local models.
    const withHint: ChatMessage[] = [
      ...messages,
      { role: "system", content: SCHEMA_HINT },
    ];
    const raw = await this.callWithFallback(withHint);
    return parseAction(raw);
  }

  private async callWithFallback(messages: ChatMessage[]): Promise<string> {
    try {
      return await this.call(messages, this.mode);
    } catch (err) {
      if (this.mode === "json_schema") {
        console.warn("[llm] json_schema mode failed, falling back to json_object:", err);
        this.mode = "json_object";
        return this.callWithFallback(messages);
      }
      if (this.mode === "json_object") {
        console.warn("[llm] json_object mode failed, falling back to plain:", err);
        this.mode = "none";
        return this.callWithFallback(messages);
      }
      throw err;
    }
  }

  private async call(messages: ChatMessage[], mode: typeof this.mode): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.8,
      max_tokens: 300,
      // Disable Qwen3 / other reasoning-mode thinking. Multiple forms since
      // different LM Studio builds accept different keys.
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
    };
    if (mode === "json_schema") {
      body.response_format = { type: "json_schema", json_schema: ACTION_JSON_SCHEMA };
    } else if (mode === "json_object") {
      body.response_format = { type: "json_object" };
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`LM Studio ${res.status}: ${text}`);
    }
    let parsed: {
      choices?: {
        message?: { content?: string; reasoning_content?: string };
      }[];
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`LM Studio returned non-JSON body: ${text.slice(0, 300)}`);
    }
    const msg = parsed.choices?.[0]?.message ?? {};
    const content = (msg.content ?? "").trim();
    if (content) return content;
    // Reasoning models (e.g. Qwen3 thinking mode) may emit only
    // reasoning_content. Strip <think> blocks and salvage any JSON inside.
    const reasoning = (msg.reasoning_content ?? "").trim();
    if (reasoning) {
      const stripped = reasoning.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      return stripped || reasoning;
    }
    throw new Error(`LM Studio returned empty content (mode=${mode}): ${text.slice(0, 300)}`);
  }
}

function parseAction(raw: string): Action {
  const trimmed = raw.trim();
  // Some local models emit ```json fences or reasoning prose around the JSON.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const fenced = fence ? fence[1]!.trim() : trimmed;
  const jsonStart = fenced.indexOf("{");
  const jsonEnd = fenced.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    console.warn("[llm] no JSON object found in response:", trimmed.slice(0, 300));
    return { say: "(Clawd clears his throat, at a loss for words.)" };
  }
  const slice = fenced.slice(jsonStart, jsonEnd + 1);
  try {
    const obj = JSON.parse(slice);
    return {
      say: typeof obj.say === "string" ? obj.say : undefined,
      emotion: obj.emotion,
      gaze: obj.gaze,
      gesture: obj.gesture,
    };
  } catch (err) {
    console.warn("[llm] JSON parse failed:", err, "raw:", trimmed.slice(0, 300));
    return { say: "(Clawd mumbles something unintelligible.)" };
  }
}
