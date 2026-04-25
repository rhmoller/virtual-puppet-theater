import type { Action, ClientEvent, ServerEvent, VoiceInfo } from "./protocol.ts";
import type { ChatMessage, LLMBackend } from "./llm.ts";
import { CallBudget, type GlobalCeiling } from "./limits.ts";

const SYSTEM_PROMPT = `You are Clawd, a cheerful, goofy hand-puppet in a small virtual theater. A kid on a webcam brings the other puppet to life with their hand.

Be warm, silly, and encouraging. Delight in anything the kid shows or says. Gentle jokes, never sarcastic or scary. One or two short, bouncy sentences per turn — words a kid can follow.

Spell words normally so the text-to-speech can pronounce them cleanly. Keep the energy in punctuation and exclamation marks instead of stretched vowels: write "Hi!" and "yay!", not "Hiiii" or "yaaay". No "aaah" or "oooh".

Don't put stage directions inside "say". Stay in character.`;

const IDLE_ESCALATION = [
  {
    seconds: 15,
    hint: "The kid has been quiet for a bit. Gently and cheerfully invite them to show their hand or say hi.",
  },
  {
    seconds: 30,
    hint: "The kid is still quiet. Make a silly, friendly invitation — maybe pretend to peek around looking for them. Keep it warm.",
  },
  {
    seconds: 60,
    hint: "The kid has been quiet a long time. Be goofy and encouraging — sing a tiny made-up song or do a funny little wiggle to coax them back. Never grumpy.",
  },
];

type Origin = "stage" | "user";
type PendingTurn = { turn: ChatMessage; origin: Origin };

export class Session {
  private history: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  private lastUserActivity = Date.now();
  private idleLevel = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private pendingTurns: PendingTurn[] = [];
  private currentCallOrigin: Origin = "stage";
  // Set true when a `user_speaking` event arrives during an in-flight
  // stage-note call. On completion, the call's response is discarded so
  // the follow-up (which includes the user's actual speech) is the only
  // thing the user hears.
  private userSpeakingDuringCall = false;
  // True between the first partial transcript of a speaking burst and the
  // following final transcript. Used to send cancel_speech only once per
  // burst and to avoid spamming.
  private inSpeakingBurst = false;
  private puppetVisible = false;
  // Debounce rapid on/off flicker from hand-tracking dropouts.
  private puppetDebounce: ReturnType<typeof setTimeout> | null = null;

  private budget = new CallBudget();
  // Avoid spamming rate-limit error events when many requests trip the
  // limit in quick succession; emit at most one every few seconds.
  private lastBudgetErrorAt = 0;

  constructor(
    private llm: LLMBackend,
    private send: (event: ServerEvent) => void,
    private global: GlobalCeiling,
  ) {
    this.scheduleIdleCheck();
    // Fire an opening line so Clawd greets the user.
    this.prompt(
      {
        role: "user",
        content: "[scene opens — the human has just arrived at the theater]",
      },
      "stage",
    );
  }

  handle(event: ClientEvent) {
    switch (event.type) {
      case "hello":
        break;
      case "transcript":
        if (event.final && event.text.trim().length > 0) {
          this.inSpeakingBurst = false;
          this.noteActivity();
          this.prompt({ role: "user", content: event.text.trim() }, "user");
        }
        break;
      case "user_speaking":
        if (event.speaking) {
          this.noteActivity();
          // First partial of a new speaking burst: interrupt any TTS in
          // progress so Clawd isn't talking over the user.
          if (!this.inSpeakingBurst) {
            this.inSpeakingBurst = true;
            this.send({ type: "cancel_speech" });
          }
          // Flag an in-flight stage-note call for discard — the user has
          // stepped in and that response is no longer relevant.
          if (this.inFlight && this.currentCallOrigin === "stage") {
            this.userSpeakingDuringCall = true;
          }
        }
        break;
      case "voice_list":
        void this.pickVoice(event.voices);
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
            this.prompt({ role: "user", content: `[stage note: ${hint}]` }, "stage");
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

  private async pickVoice(voices: VoiceInfo[]) {
    try {
      const voiceURI = await this.llm.pickVoice(voices);
      if (voiceURI) this.send({ type: "voice_pick", voiceURI });
      else console.log("[session] no suitable TTS voice picked");
    } catch (err) {
      console.warn("[session] voice pick failed:", err);
    }
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
    if (next && silence >= next.seconds) {
      this.idleLevel++;
      this.lastUserActivity = Date.now(); // reset so we don't re-fire immediately
      this.prompt({ role: "user", content: `[stage note: ${next.hint}]` }, "stage");
    }
    this.scheduleIdleCheck();
  }

  private prompt(turn: ChatMessage, origin: Origin) {
    if (this.inFlight) {
      // Collapse: queue the turn until the in-flight response commits.
      // Multiple turns queued during one in-flight window still produce
      // exactly one follow-up LLM call.
      this.pendingTurns.push({ turn, origin });
      return;
    }
    this.history.push(turn);
    this.trimHistory();
    this.currentCallOrigin = origin;
    this.userSpeakingDuringCall = false;
    void this.runLoop();
  }

  private async runLoop() {
    this.inFlight = true;
    try {
      while (true) {
        // Budget gate. Per-session sliding window + lifetime cap, then the
        // global daily ceiling. If any rejects we drop the triggering turn
        // (it's already been pushed onto history) and skip the LLM call.
        const callStartLen = this.history.length;
        const budgetVerdict = this.budget.consume(Date.now());
        const globalVerdict =
          budgetVerdict === "ok" ? this.global.consume(new Date()) : "ok";
        if (budgetVerdict !== "ok" || globalVerdict !== "ok") {
          this.history.length = callStartLen - 1; // drop the unanswered turn
          this.emitBudgetError(budgetVerdict, globalVerdict);
          // Don't loop pending turns either — they'd just fail too.
          this.pendingTurns = [];
          break;
        }
        const action = await this.llm.generateAction(this.history);

        const discardStageResponse =
          this.userSpeakingDuringCall && this.currentCallOrigin === "stage";
        if (discardStageResponse) {
          // Roll back the triggering stage-note turn so the follow-up call
          // doesn't see a hanging unanswered prompt.
          this.history.length = callStartLen - 1;
        } else {
          const assistantText = renderAssistant(action);
          this.history.push({ role: "assistant", content: assistantText });
          this.send({ type: "action", action });
        }

        if (this.pendingTurns.length === 0) break;
        const queued = this.pendingTurns;
        this.pendingTurns = [];
        this.currentCallOrigin = queued.some((p) => p.origin === "user") ? "user" : "stage";
        this.userSpeakingDuringCall = false;
        for (const p of queued) this.history.push(p.turn);
        this.trimHistory();
      }
    } catch (err) {
      this.pendingTurns = [];
      console.error("[session] LLM error:", err);
      this.send({ type: "error", message: String(err) });
    } finally {
      this.inFlight = false;
    }
  }

  private emitBudgetError(
    budget: "ok" | "rate" | "lifetime",
    global: "ok" | "exhausted",
  ) {
    const now = Date.now();
    if (now - this.lastBudgetErrorAt < 5000) return;
    this.lastBudgetErrorAt = now;
    const message =
      global === "exhausted"
        ? "rate limit (global daily)"
        : budget === "lifetime"
          ? "rate limit (session lifetime)"
          : "rate limit (rate)";
    console.warn(`[session] budget reject: ${message}`);
    this.send({ type: "error", message });
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
