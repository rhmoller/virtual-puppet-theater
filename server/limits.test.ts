import { test, expect } from "bun:test";
import {
  IpConnectionCounter,
  CallBudget,
  GlobalCeiling,
  clientIpFrom,
  originAllowed,
} from "./limits.ts";

test("IpConnectionCounter caps at limit and frees on release", () => {
  const c = new IpConnectionCounter(2);
  expect(c.tryAcquire("1.2.3.4")).toBe(true);
  expect(c.tryAcquire("1.2.3.4")).toBe(true);
  expect(c.tryAcquire("1.2.3.4")).toBe(false); // at limit
  c.release("1.2.3.4");
  expect(c.tryAcquire("1.2.3.4")).toBe(true);
  // Different IPs share no budget.
  expect(c.tryAcquire("5.6.7.8")).toBe(true);
});

test("IpConnectionCounter deletes zero-count keys to bound memory", () => {
  const c = new IpConnectionCounter(2);
  c.tryAcquire("a");
  c.tryAcquire("a");
  expect(c.size()).toBe(1);
  c.release("a");
  c.release("a");
  expect(c.size()).toBe(0);
});

test("CallBudget sliding window admits N then rejects, then admits again after window", () => {
  const b = new CallBudget(3, 1000, 100); // 3 per 1s, lifetime 100
  let now = 1_000_000;
  expect(b.consume(now)).toBe("ok");
  expect(b.consume(now)).toBe("ok");
  expect(b.consume(now)).toBe("ok");
  expect(b.consume(now)).toBe("rate");
  // Slide past the window.
  now += 1100;
  expect(b.consume(now)).toBe("ok");
});

test("CallBudget enforces lifetime cap independently of window", () => {
  const b = new CallBudget(100, 60_000, 3); // generous window, lifetime 3
  let now = 1_000_000;
  expect(b.consume(now)).toBe("ok");
  expect(b.consume(now)).toBe("ok");
  expect(b.consume(now)).toBe("ok");
  // Even crossing the window doesn't help; lifetime is exhausted.
  now += 120_000;
  expect(b.consume(now)).toBe("lifetime");
});

test("GlobalCeiling caps per UTC day and resets on rollover", () => {
  const g = new GlobalCeiling(2);
  const t1 = new Date("2026-04-25T10:00:00Z");
  const t2 = new Date("2026-04-25T23:59:59Z");
  const t3 = new Date("2026-04-26T00:00:01Z");
  expect(g.consume(t1)).toBe("ok");
  expect(g.consume(t1)).toBe("ok");
  expect(g.consume(t2)).toBe("exhausted");
  // New UTC day → counter resets.
  expect(g.consume(t3)).toBe("ok");
});

test("clientIpFrom prefers Fly-Client-IP, falls back to XFF then 'local'", () => {
  const fly = new Headers({ "fly-client-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" });
  expect(clientIpFrom(fly)).toBe("9.9.9.9");
  const xff = new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" });
  expect(clientIpFrom(xff)).toBe("1.1.1.1");
  const none = new Headers();
  expect(clientIpFrom(none)).toBe("local");
});

test("originAllowed admits the prod and dev origins, rejects others and missing", () => {
  const ok = new Headers({ origin: "https://hackathon-puppet.fly.dev" });
  expect(originAllowed(ok)).toBe(true);
  const dev = new Headers({ origin: "http://localhost:5173" });
  expect(originAllowed(dev)).toBe(true);
  const bad = new Headers({ origin: "https://evil.example" });
  expect(originAllowed(bad)).toBe(false);
  const missing = new Headers();
  expect(originAllowed(missing)).toBe(false);
});
