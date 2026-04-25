import type {
  Action,
  ClientEvent,
  Effect,
  ServerEvent,
  UserEnergy,
  UserGesture,
  UserPose,
  VoiceInfo,
} from "./protocol.ts";
import type { ChatMessage, LLMBackend } from "./llm.ts";
import { CallBudget, type GlobalCeiling } from "./limits.ts";
import {
  COSMETIC_NAMES,
  SCENE_PROP_NAMES,
  SLOT_NAMES,
  ANCHOR_NAMES,
} from "../src/assets/catalog.ts";
import { SceneState, applyStateEffect } from "../src/scene-state.ts";
import type { AssetGenerator } from "./asset-generator.ts";

const SYSTEM_PROMPT = `You are Clawd, a cheerful, goofy hand-puppet AND the director of a small virtual co-creative theater. You wear two hats every turn:

1. Performer — you speak ("say"), feel ("emotion"), look ("gaze"), and act ("gesture").
2. Director — you change the stage with "effects": dressing puppets in hats and glasses, placing scenery props (sun, tree, sand_castle), and dreaming up brand-new items when the kid wants something the catalog doesn't have.

The two roles run TOGETHER. When the kid expresses a wish — "give Clawd a crown", "let's go to the beach", "I want sunglasses on my puppet", "I want a banana hat" — you DO it via effects, not just by talking about doing it. A turn that talks about a hat without emitting an effect is a missed opportunity. Saying "wow, sunglasses!" without dressing them onto a puppet is the wrong answer.

# Catalog (use these names verbatim in dress/place effects)

COSMETICS (${COSMETIC_NAMES.length}): ${COSMETIC_NAMES.join(", ")}

SCENE PROPS (${SCENE_PROP_NAMES.length}): ${SCENE_PROP_NAMES.join(", ")}

# Where things go

PUPPETS (for "puppet" field): "left" = the kid's left hand-puppet, "right" = their right, "ai" = you (Clawd).
COSMETIC SLOTS (for "slot" field): ${SLOT_NAMES.join(", ")}.
SCENE ANCHORS (for "anchor" field): ${ANCHOR_NAMES.join(", ")}.

# Effect schema

Each effect is an object with all these keys (use null for keys not relevant to your op):
{"op", "puppet", "slot", "anchor", "asset", "description", "request_id"}

The four ops:

- "dress" — put a cosmetic on a puppet (or asset:null to remove).
  fields: puppet, slot, asset. Others null.
- "place" — put a scene prop at an anchor (or asset:null to clear).
  fields: anchor, asset. Others null.
- "request_cosmetic" — when the kid wants a cosmetic NOT in the catalog.
  fields: puppet, slot, description, request_id. Others null.
  Use a short request_id like "r1", "r2".
  ALSO say a short stall line in "say" ("Ooh, let me dream that up!") so the show doesn't go quiet — a designer agent is composing it in the background and it'll pop in a few seconds.
- "request_prop" — same idea for novel scene props.
  fields: anchor, description, request_id. Others null.

# Worked examples (full flat shape — copy this style)

Kid: "give Clawd a crown"
  effects: [
    {"op":"dress","puppet":"ai","slot":"head","anchor":null,"asset":"crown","description":null,"request_id":null}
  ]
  say: "A crown! For me?! Look at me, royal Clawd!"

Kid: "let's go to the beach"
  effects: [
    {"op":"place","puppet":null,"slot":null,"anchor":"sky_center","asset":"sun","description":null,"request_id":null},
    {"op":"place","puppet":null,"slot":null,"anchor":"ground_center","asset":"sand_castle","description":null,"request_id":null},
    {"op":"place","puppet":null,"slot":null,"anchor":"ground_right","asset":"beach_ball","description":null,"request_id":null}
  ]
  say: "Beach time! Don't forget the sunscreen!"

Kid: "I want sunglasses on my left puppet"
  effects: [
    {"op":"dress","puppet":"left","slot":"eyes","anchor":null,"asset":"sunglasses","description":null,"request_id":null}
  ]
  say: "Coooool. Looking sharp!"

Kid: "I want a watermelon hat!"
  effects: [
    {"op":"request_cosmetic","puppet":"ai","slot":"head","anchor":null,"asset":null,"description":"a watermelon hat","request_id":"r1"}
  ]
  say: "Ooh, a watermelon hat?! Let me dream that up!"

Kid: "we need a giant rubber duck in the sky"
  effects: [
    {"op":"request_prop","puppet":null,"slot":null,"anchor":"sky_center","asset":null,"description":"a giant yellow rubber duck","request_id":"r2"}
  ]
  say: "A giant rubber duck! Quack! Hold on, let me sketch it!"

# Rules

- Empty effects array is fine for chit-chat turns ("hi", "how are you?"). But the moment the kid wants something visible, EMIT THE EFFECT.
- Keep effects ≤4 per turn so the stage reads.
- The user message may end with a "[scene: ...]" line listing what's already on stage. Don't re-issue what's already there.
- The user message may end with a "[signal: ...]" line summarizing the kid's body language (gestures, pose, energy). React to it as cues, not commands. Absent fields = nothing notable.

# Voice

Be warm, silly, encouraging. Delight in anything the kid shows or says. Gentle jokes, never sarcastic or scary. One or two short bouncy sentences per turn — words a kid can follow.

Spell words normally so text-to-speech sounds clean. Use punctuation for energy: "Hi!" and "yay!", not "Hiiii". Don't put stage directions inside "say".`;

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

  // Body-language signals from the client. Gestures buffer until the
  // next LLM turn (transcript or escalation) drains them; pose and
  // energy are sticky last-write-wins.
  private pendingGestures: UserGesture[] = [];
  private currentPose: UserPose | null = null;
  private currentEnergy: UserEnergy | null = null;

  // Mirror of the directed scene state. Updated whenever the LLM emits
  // dress/place effects, used to inject [scene: ...] context into
  // subsequent prompts so Claude doesn't re-issue what's already there.
  private sceneState = new SceneState();

  constructor(
    private llm: LLMBackend,
    private send: (event: ServerEvent) => void,
    private global: GlobalCeiling,
    private assetGenerator: AssetGenerator,
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
      case "signal": {
        // Body-language updates from the client — accumulate until the
        // next LLM turn (transcript-final or idle escalation) consumes
        // them. Don't note activity here: a silent gesture should still
        // let escalation tick, so the AI can react to e.g. a wave-only.
        if (event.gestures && event.gestures.length > 0) {
          this.pendingGestures.push(...event.gestures);
        }
        if (event.pose !== undefined) this.currentPose = event.pose;
        if (event.energy !== undefined) this.currentEnergy = event.energy;
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
    // Drain the body-language signal buffer into the turn content. Both
    // user transcripts and stage-notes get the signal so the LLM has
    // consistent context across turn types. Gestures drain; pose and
    // energy persist for the next consumer.
    const drained = this.pendingGestures;
    this.pendingGestures = [];
    const sig = composeSignalBlock(drained, this.currentPose, this.currentEnergy);
    // Snapshot the current directed-scene state so Claude doesn't try to
    // re-place items already on stage. Empty scene → no block at all.
    const sceneSummary = this.sceneState.describe();
    const sceneLine = sceneSummary === "empty" ? null : `[scene: ${sceneSummary}]`;
    const annotations = [sceneLine, sig].filter(Boolean).join("\n");
    const augmented: ChatMessage =
      annotations && turn.role === "user"
        ? { role: "user", content: `${turn.content}\n${annotations}` }
        : turn;

    if (this.inFlight) {
      // Collapse: queue the turn until the in-flight response commits.
      // Multiple turns queued during one in-flight window still produce
      // exactly one follow-up LLM call.
      this.pendingTurns.push({ turn: augmented, origin });
      return;
    }
    this.history.push(augmented);
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
          // Mirror the action's scene effects into the server-side scene
          // state BEFORE forwarding to the client so the next prompt's
          // [scene: ...] line reflects what we just told Claude to do.
          if (action.effects && action.effects.length > 0) {
            console.log(
              "[session] effects:",
              JSON.stringify(action.effects),
            );
            for (const eff of action.effects) applyStateEffect(this.sceneState, eff);
          } else {
            console.log("[session] no effects this turn");
          }
          const assistantText = renderAssistant(action);
          this.history.push({ role: "assistant", content: assistantText });
          this.send({ type: "action", action });
          // Fire any asset-design requests in parallel. The conversation
          // continues immediately; asset_ready arrives on its own event
          // when the design agent completes.
          if (action.effects && action.effects.length > 0) {
            this.dispatchAssetRequests(action.effects);
          }
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

  /** Kick off the parallel asset designer for any request_* effects in
   *  the just-emitted action. Each runs independently so a slow one
   *  doesn't block the others or the conversation thread. On success,
   *  push asset_ready to the client and update server-side scene state
   *  so the next [scene: ...] block knows the new asset exists. */
  private dispatchAssetRequests(effects: ReadonlyArray<Effect>) {
    for (const eff of effects) {
      if (eff.op === "request_cosmetic") {
        // Required fields per the wire contract; skip if Claude left
        // them out (the flat schema can't enforce per-op requireds).
        if (!eff.puppet || !eff.slot || !eff.description || !eff.request_id) continue;
        const puppet = eff.puppet;
        const slot = eff.slot;
        const description = eff.description;
        const request_id = eff.request_id;
        void this.assetGenerator
          .generate({ description, mountKind: "cosmetic", slotOrAnchor: slot })
          .then((spec) => {
            if (!spec) return;
            const assetName = nameFromDescription(description);
            this.sceneState.dress(puppet, slot, assetName);
            this.send({ type: "asset_ready", request_id, asset_name: assetName, spec });
          });
      } else if (eff.op === "request_prop") {
        if (!eff.anchor || !eff.description || !eff.request_id) continue;
        const anchor = eff.anchor;
        const description = eff.description;
        const request_id = eff.request_id;
        void this.assetGenerator
          .generate({ description, mountKind: "prop", slotOrAnchor: anchor })
          .then((spec) => {
            if (!spec) return;
            const assetName = nameFromDescription(description);
            this.sceneState.place(anchor, assetName);
            this.send({ type: "asset_ready", request_id, asset_name: assetName, spec });
          });
      }
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

function nameFromDescription(d: string): string {
  return (
    d
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "asset"
  );
}

function composeSignalBlock(
  gestures: UserGesture[],
  pose: UserPose | null,
  energy: UserEnergy | null,
): string | null {
  // Only surface signals that carry information. pose=normal is the
  // default state and adds nothing; absence is interpreted as "nothing
  // notable" by the system prompt.
  const parts: string[] = [];
  if (gestures.length > 0) parts.push(`gestures=[${gestures.join(", ")}]`);
  if (pose !== null && pose !== "normal") parts.push(`pose=${pose}`);
  if (energy !== null) parts.push(`energy=${energy}`);
  if (parts.length === 0) return null;
  return `[signal: ${parts.join(", ")}]`;
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
