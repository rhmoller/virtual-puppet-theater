import { test, expect } from "bun:test";
import { Session } from "./session.ts";
import { GlobalCeiling } from "./limits.ts";
import type { ChatMessage, LLMBackend } from "./llm.ts";
import type { Action, AssetSpec, ServerEvent } from "./protocol.ts";
import type { AssetGenerator } from "./asset-generator.ts";

// Stub for the asset designer — tests don't exercise asset generation.
const fakeAssetGenerator: AssetGenerator = {
  generate: async (_args: unknown): Promise<AssetSpec | null> => null,
} as unknown as AssetGenerator;

class FakeLLM implements LLMBackend {
  name = "fake";
  calls: ChatMessage[][] = [];
  voicePickCalls: number = 0;
  private pending: Array<(a: Action) => void> = [];

  async generateAction(messages: ChatMessage[]): Promise<Action> {
    this.calls.push([...messages]);
    return new Promise<Action>((resolve) => {
      this.pending.push(resolve);
    });
  }

  async pickVoice(): Promise<string | null> {
    this.voicePickCalls++;
    return null;
  }

  resolveNext(action: Action = { say: "ok", emotion: "neutral", gaze: "user", gesture: "none" }) {
    const next = this.pending.shift();
    if (!next) throw new Error("FakeLLM: resolveNext called with no pending promise");
    next(action);
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

// Wait for microtasks + a macrotask so awaited state transitions settle
// before the next assertion.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// Reach into the session for test-only introspection. Private by convention
// in production code, explicit access here so each test reads as a spec.
type SessionInternals = {
  history: ChatMessage[];
  lastUserActivity: number;
  checkIdle: () => void;
};
const inspect = (s: Session) => s as unknown as SessionInternals;

test("SESSION-1: a user turn arriving while in-flight is preserved for the next LLM call", async () => {
  const llm = new FakeLLM();
  const sent: ServerEvent[] = [];
  const session = new Session(llm, (e) => sent.push(e), new GlobalCeiling(), fakeAssetGenerator);

  // Constructor fires an opening prompt — that call is now pending.
  await flush();
  expect(llm.calls.length).toBe(1);

  session.handle({ type: "transcript", text: "hi", final: true });

  // Resolve the in-flight call; the queued turn must be visible in the
  // follow-up's history.
  llm.resolveNext();
  await flush();

  expect(llm.calls.length).toBe(2);
  const followup = llm.calls[1]!;
  expect(followup.some((m) => m.role === "user" && m.content === "hi")).toBe(true);

  llm.resolveNext();
  await flush();
  session.close();
});

test("SESSION-2: in-flight resolve triggers a follow-up for the newest user turn", async () => {
  const llm = new FakeLLM();
  const sent: ServerEvent[] = [];
  const session = new Session(llm, (e) => sent.push(e), new GlobalCeiling(), fakeAssetGenerator);
  await flush();

  session.handle({ type: "transcript", text: "hi", final: true });
  expect(llm.calls.length).toBe(1); // opening still in-flight

  llm.resolveNext();
  await flush();

  expect(llm.calls.length).toBe(2);
  const second = llm.calls[1]!;
  expect(second[second.length - 1]).toEqual({ role: "user", content: "hi" });

  llm.resolveNext();
  await flush();
  expect(llm.calls.length).toBe(2); // no further calls once the follow-up finishes

  session.close();
});

test("SESSION-3: N user turns in one in-flight window produce exactly one follow-up", async () => {
  const llm = new FakeLLM();
  const sent: ServerEvent[] = [];
  const session = new Session(llm, (e) => sent.push(e), new GlobalCeiling(), fakeAssetGenerator);
  await flush();
  expect(llm.calls.length).toBe(1);

  session.handle({ type: "transcript", text: "one", final: true });
  session.handle({ type: "transcript", text: "two", final: true });
  session.handle({ type: "transcript", text: "three", final: true });

  llm.resolveNext(); // opening resolves
  await flush();

  expect(llm.calls.length).toBe(2);

  const followup = llm.calls[1]!;
  const lastUser = followup.toReversed().find((m) => m.role === "user");
  expect(lastUser?.content).toBe("three");

  llm.resolveNext();
  await flush();
  expect(llm.calls.length).toBe(2);

  session.close();
});

test("SESSION-5: user_speaking during a stage-note call discards that response", async () => {
  const llm = new FakeLLM();
  const sent: ServerEvent[] = [];
  const session = new Session(llm, (e) => sent.push(e), new GlobalCeiling(), fakeAssetGenerator);

  // Constructor fires the opening stage prompt — that call is now in-flight.
  await flush();
  expect(llm.calls.length).toBe(1);

  // User starts speaking while the stage-note call is in-flight.
  session.handle({ type: "user_speaking", speaking: true });
  // The server must ask the client to cut off any TTS in progress.
  expect(sent.some((e) => e.type === "cancel_speech")).toBe(true);

  // User's actual transcript arrives before the opening resolves.
  session.handle({ type: "transcript", text: "hi there", final: true });

  // Opening resolves — its action must not be sent because user_speaking
  // flagged it stale.
  llm.resolveNext({ say: "stale reply", emotion: "neutral", gaze: "user", gesture: "none" });
  await flush();

  expect(sent.filter((e) => e.type === "action").length).toBe(0);

  // Follow-up call runs with the user's turn; the stage-note turn was
  // rolled back from history so the model only sees the user's speech.
  expect(llm.calls.length).toBe(2);
  const followup = llm.calls[1]!;
  expect(followup.some((m) => m.role === "user" && m.content === "hi there")).toBe(true);
  expect(followup.some((m) => m.content.startsWith("[scene opens"))).toBe(false);

  llm.resolveNext({ say: "hi back", emotion: "excited", gaze: "user", gesture: "wave" });
  await flush();

  const actions = sent.filter(
    (e): e is { type: "action"; action: { say?: string } } => e.type === "action",
  );
  expect(actions.length).toBe(1);
  expect(actions[0]!.action.say).toBe("hi back");

  session.close();
});

test("SESSION-6: signal events bake gestures + pose + energy into the next user turn", async () => {
  const llm = new FakeLLM();
  const sent: ServerEvent[] = [];
  const session = new Session(llm, (e) => sent.push(e), new GlobalCeiling(), fakeAssetGenerator);
  await flush();

  // Pre-load body-language signals before the user speaks.
  session.handle({ type: "signal", gestures: ["wave"], pose: "normal", energy: "high" });
  session.handle({ type: "signal", gestures: ["thumbs_up"], pose: "upside_down" });
  session.handle({ type: "transcript", text: "hello", final: true });

  // Resolve the opening; the follow-up call carries the user turn with
  // both gestures merged + the latest pose + energy.
  llm.resolveNext();
  await flush();

  expect(llm.calls.length).toBe(2);
  const followup = llm.calls[1]!;
  const userTurn = followup.findLast((m) => m.role === "user");
  expect(userTurn?.content).toContain("hello");
  expect(userTurn?.content).toContain("[signal:");
  expect(userTurn?.content).toContain("gestures=[wave, thumbs_up]");
  expect(userTurn?.content).toContain("pose=upside_down");
  expect(userTurn?.content).toContain("energy=high");

  // Next turn: gesture buffer drained, pose + energy still sticky.
  session.handle({ type: "transcript", text: "again", final: true });
  llm.resolveNext();
  await flush();

  const third = llm.calls[2]!;
  const lastUser = third.findLast((m) => m.role === "user");
  expect(lastUser?.content).toContain("again");
  expect(lastUser?.content).not.toContain("gestures=");
  expect(lastUser?.content).toContain("pose=upside_down");
  expect(lastUser?.content).toContain("energy=high");

  llm.resolveNext();
  await flush();
  session.close();
});

test("SESSION-7: idle escalation prompts include the latest pose + drained gestures", async () => {
  const llm = new FakeLLM();
  const sent: ServerEvent[] = [];
  const session = new Session(llm, (e) => sent.push(e), new GlobalCeiling(), fakeAssetGenerator);
  await flush();
  expect(llm.calls.length).toBe(1);

  // Resolve the opening and drain its (empty) signal block.
  llm.resolveNext();
  await flush();

  // User flips the puppet upside down and waves silently.
  session.handle({ type: "signal", pose: "upside_down" });
  session.handle({ type: "signal", gestures: ["wave"] });

  // Force an idle escalation by rewinding lastUserActivity. The check
  // lands as a stage note; signal block must include both pose + gesture.
  const s = inspect(session);
  s.lastUserActivity = Date.now() - 20_000;
  s.checkIdle();

  expect(llm.calls.length).toBe(2);
  const escalation = llm.calls[1]!;
  const stageTurn = escalation.findLast((m) => m.role === "user");
  expect(stageTurn?.content).toContain("[stage note:");
  expect(stageTurn?.content).toContain("[signal:");
  expect(stageTurn?.content).toContain("gestures=[wave]");
  expect(stageTurn?.content).toContain("pose=upside_down");

  llm.resolveNext();
  await flush();
  session.close();
});

test("SESSION-4: idle-escalation ticks while in-flight collapse into one follow-up", async () => {
  const llm = new FakeLLM();
  const sent: ServerEvent[] = [];
  const session = new Session(llm, (e) => sent.push(e), new GlobalCeiling(), fakeAssetGenerator);
  await flush();
  expect(llm.calls.length).toBe(1);

  // Simulate silence past level-0 threshold (15s) while the opening call is in-flight.
  const s = inspect(session);
  s.lastUserActivity = Date.now() - 20_000;
  s.checkIdle();

  // A later tick while still in-flight must not stack a second follow-up.
  s.lastUserActivity = Date.now() - 40_000;
  s.checkIdle();

  llm.resolveNext(); // opening resolves
  await flush();

  expect(llm.calls.length).toBe(2); // exactly one follow-up, not two

  // That follow-up's history should contain at least one idle stage note.
  const followup = llm.calls[1]!;
  expect(followup.some((m) => m.role === "user" && m.content.startsWith("[stage note:"))).toBe(
    true,
  );

  llm.resolveNext();
  await flush();
  expect(llm.calls.length).toBe(2);

  session.close();
});
