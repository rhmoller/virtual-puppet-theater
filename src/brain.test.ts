import { test, expect, beforeEach, afterEach, jest } from "bun:test";
import { Brain } from "./brain.ts";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = FakeWebSocket.CONNECTING;
  url: string;
  sent: string[] = [];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: unknown) => void) {
    (this.listeners[type] ||= []).push(cb);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.fire("close", {});
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.fire("open", {});
  }

  private fire(type: string, ev: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

const handlers = { onAction: () => {}, onCancelSpeech: () => {}, onVoicePick: () => {} };

type GlobalWithWebSocket = { WebSocket?: unknown };
let savedWebSocket: unknown;

beforeEach(() => {
  const g = globalThis as GlobalWithWebSocket;
  savedWebSocket = g.WebSocket;
  g.WebSocket = FakeWebSocket as unknown;
  FakeWebSocket.instances = [];
});

afterEach(() => {
  const g = globalThis as GlobalWithWebSocket;
  g.WebSocket = savedWebSocket;
  jest.useRealTimers();
});

test("BRAIN-1: stop() is a public method", () => {
  const brain = new Brain("ws://x/y", handlers);
  expect(typeof (brain as unknown as { stop?: () => void }).stop).toBe("function");
});

test("BRAIN-2: stop() clears the flush interval handle", () => {
  jest.useFakeTimers();
  const brain = new Brain("ws://x/y", handlers);
  brain.start();

  const internals = brain as unknown as { flushInterval?: unknown };
  expect(internals.flushInterval).toBeDefined();
  expect(internals.flushInterval).not.toBeNull();

  brain.stop();
  expect(internals.flushInterval).toBeNull();
});

test("BRAIN-3: stop() prevents reconnect when the socket closes", () => {
  jest.useFakeTimers();
  const brain = new Brain("ws://x/y", handlers);
  brain.start();

  expect(FakeWebSocket.instances.length).toBe(1);

  brain.stop();

  // Give every reconnect schedule plenty of time to fire.
  jest.advanceTimersByTime(30_000);

  expect(FakeWebSocket.instances.length).toBe(1);
});
