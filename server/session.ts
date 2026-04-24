import type { Action, ClientEvent, ServerEvent } from "./protocol.ts";
import type { ChatMessage, LLMBackend } from "./llm.ts";

const SYSTEM_PROMPT = `You are Clawd, a scruffy, mischievous sock-puppet who shares a small virtual theater with a human-controlled puppet. The human uses a webcam and their hand to animate the other puppet. You live stage-left and react to what the human says and does.

Personality: wry, theatrical, a touch vain, warm underneath. You tease the human gently when they are shy, and riff when they play along. Keep lines short — one or two sentences, like a stage aside.

You always respond with a single structured action: what you say, your emotion, where you look, and a gesture. Do not narrate stage directions inside "say". Never break character. Never mention that you are an AI.`;

const IDLE_ESCALATION = [
  { seconds: 15, hint: "The human has been quiet for a bit. Coax them into showing their hand or speaking. Friendly." },
  { seconds: 30, hint: "The human is still silent. Tease them gently — pretend to be bored, or impatient." },
  { seconds: 60, hint: "The human has been silent a long time. Be theatrically exasperated. Beg for attention." },
];

export class Session {
  private history: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  private lastUserActivity = Date.now();
  private idleLevel = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private puppetVisible = false;
  // Debounce rapid on/off flicker from hand-tracking dropouts.
  private puppetDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private llm: LLMBackend,
    private send: (event: ServerEvent) => void,
  ) {
    this.scheduleIdleCheck();
    // Fire an opening line so Clawd greets the user.
    this.prompt({
      role: "user",
      content: "[scene opens — the human has just arrived at the theater]",
    });
  }

  handle(event: ClientEvent) {
    switch (event.type) {
      case "hello":
        break;
      case "transcript":
        if (event.final && event.text.trim().length > 0) {
          this.noteActivity();
          this.prompt({ role: "user", content: event.text.trim() });
        }
        break;
      case "user_speaking":
        if (event.speaking) this.noteActivity();
        break;
      case "puppet_state": {
        const visible = event.leftVisible || event.rightVisible;
        if (visible) this.noteActivity();
        if (visible !== this.puppetVisible) {
          if (this.puppetDebounce) clearTimeout(this.puppetDebounce);
          this.puppetDebounce = setTimeout(() => {
            this.puppetDebounce = null;
            if (visible === this.puppetVisible) return;
            this.puppetVisible = visible;
            const hint = visible
              ? "The human's puppet has just appeared on stage. React to their entrance."
              : "The human's puppet has just left the stage. React to the empty spot beside you.";
            this.prompt({ role: "user", content: `[stage note: ${hint}]` });
          }, 600);
        }
        break;
      }
    }
  }

  close() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.puppetDebounce) clearTimeout(this.puppetDebounce);
  }

  private noteActivity() {
    this.lastUserActivity = Date.now();
    this.idleLevel = 0;
  }

  private scheduleIdleCheck() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.checkIdle(), 5000);
  }

  private checkIdle() {
    const silence = (Date.now() - this.lastUserActivity) / 1000;
    const next = IDLE_ESCALATION[this.idleLevel];
    if (next && silence >= next.seconds && !this.inFlight) {
      this.idleLevel++;
      this.lastUserActivity = Date.now(); // reset so we don't re-fire immediately
      this.prompt({
        role: "user",
        content: `[stage note: ${next.hint}]`,
      });
    }
    this.scheduleIdleCheck();
  }

  private async prompt(turn: ChatMessage) {
    this.history.push(turn);
    this.trimHistory();
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const action = await this.llm.generateAction(this.history);
      const assistantText = renderAssistant(action);
      this.history.push({ role: "assistant", content: assistantText });
      this.send({ type: "action", action });
    } catch (err) {
      console.error("[session] LLM error:", err);
      this.send({ type: "error", message: String(err) });
    } finally {
      this.inFlight = false;
    }
  }

  private trimHistory() {
    // Keep system + last N turns to bound context.
    const MAX_TURNS = 40;
    if (this.history.length > MAX_TURNS + 1) {
      const system = this.history[0]!;
      this.history = [system, ...this.history.slice(-MAX_TURNS)];
    }
  }
}

function renderAssistant(action: Action): string {
  // Stored in history so the model has its own prior turns for continuity.
  const parts: string[] = [];
  if (action.say) parts.push(`"${action.say}"`);
  const meta: string[] = [];
  if (action.emotion) meta.push(action.emotion);
  if (action.gaze) meta.push(`looks ${action.gaze}`);
  if (action.gesture && action.gesture !== "none") meta.push(action.gesture);
  if (meta.length) parts.push(`(${meta.join(", ")})`);
  return parts.join(" ") || "(beat)";
}
