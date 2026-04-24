import { test, expect } from "bun:test";
import { Session } from "./session.ts";
import type { ChatMessage, LLMBackend } from "./llm.ts";
import type { Action, ServerEvent } from "./protocol.ts";

class FakeLLM implements LLMBackend {
  name = "fake";
  calls: ChatMessage[][] = [];
  private pending: Array<(a: Action) => void> = [];

  async generateAction(messages: ChatMessage[]): Promise<Action> {
    this.calls.push([...messages]);
    return new Promise<Action>((resolve) => {
      this.pending.push(resolve);
    });
  }

  resolveNext(
    action: Action = { say: "ok", emotion: "neutral", gaze: "user", gesture: "none" },
  ) {
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
  const session = new Session(llm, (e) => sent.push(e));

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
  const session = new Session(llm, (e) => sent.push(e));
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
  const session = new Session(llm, (e) => sent.push(e));
  await flush();
  expect(llm.calls.length).toBe(1);

  session.handle({ type: "transcript", text: "one", final: true });
  session.handle({ type: "transcript", text: "two", final: true });
  session.handle({ type: "transcript", text: "three", final: true });

  llm.resolveNext(); // opening resolves
  await flush();

  expect(llm.calls.length).toBe(2);

  const followup = llm.calls[1]!;
  const lastUser = [...followup].reverse().find((m) => m.role === "user");
  expect(lastUser?.content).toBe("three");

  llm.resolveNext();
  await flush();
  expect(llm.calls.length).toBe(2);

  session.close();
});

test("SESSION-4: idle-escalation ticks while in-flight collapse into one follow-up", async () => {
  const llm = new FakeLLM();
  const sent: ServerEvent[] = [];
  const session = new Session(llm, (e) => sent.push(e));
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
  expect(
    followup.some((m) => m.role === "user" && m.content.startsWith("[stage note:")),
  ).toBe(true);

  llm.resolveNext();
  await flush();
  expect(llm.calls.length).toBe(2);

  session.close();
});
