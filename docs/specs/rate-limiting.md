# Spec: Rate Limiting + Origin Check (pre-public-share hardening)

## Objective

Land enough abuse protection on the deployed server that the URL can be put in a public README without the realistic risk of a hostile visitor draining the Anthropic credit budget. Three concentric controls plus a global ceiling, all in-memory, single-VM. Sufficient for hackathon-scale exposure; not a substitute for real auth.

This must land before `Sunday evening` (when the GitHub repo flips public).

## Tech Stack

No new dependencies. Pure TypeScript, in-process counters and maps. No Redis, no DB.

## Commands

Unchanged. New tests run under `bun test`.

## Project Structure

```
server/limits.ts          → NEW — counters, constants, the two limiter classes
server/limits.test.ts     → NEW — unit tests for the limiters
server/index.ts           → modified: origin check + per-IP gate at upgrade time
server/session.ts         → modified: per-session call budget; consults global ceiling
docs/specs/rate-limiting.md → this file
```

No client changes.

## The Four Controls

### 1. Origin check (cheap, strong, browser-only)

On every `/ws` upgrade request, inspect the `Origin` header. Reject (HTTP 403) anything not in the allow-list. Block:

- **Allow-list (constants in `limits.ts`):**
  - `https://<app>.fly.dev`
  - `http://localhost:5173`, `http://localhost:5174`, `http://localhost:5175` (Vite dev defaults)
  - Empty `Origin` is **rejected** in production. (Browsers always set it; the absence is a non-browser client.)
- **Caveats:** `Origin` is set by browsers automatically and not by `curl`/scripts. So origin checking blocks "someone embeds my WS in their site," **not** "someone scripts my WS directly." That second threat is partially handled by the per-IP and per-session caps below.

### 2. Per-IP simultaneous connection limit

Keep a `Map<string, number>` of active WS counts keyed by IP. On upgrade:

- Read the IP from `Fly-Client-IP` (Fly's edge sets this; cannot be spoofed by the client).
- Fall back to `req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()` for local docker test scenarios; if both absent, use `"local"` as a single bucket.
- If `count >= MAX_CONCURRENT_PER_IP` (default **3**), respond HTTP 429 instead of upgrading.
- On `open(ws)`: increment.
- On `close(ws)`: decrement; delete the key when zero to bound the map.

This caps "open many tabs" and "open many connections from a single laptop." A NAT'd school network with many real users sharing one IP could legitimately bump into this; we accept that tradeoff.

### 3. Per-session call budget

Each `Session` tracks its own LLM call count. Two limits:

- **Sliding-window rate:** at most **8 LLM calls per 60 seconds**. Implemented as a small array of timestamps; trim entries older than the window before each check. (Array stays tiny because the window is short.)
- **Lifetime cap:** at most **150 LLM calls** for the duration of one Session (i.e., one WebSocket connection). Reconnecting starts a fresh budget — that's intentional, since reconnects are infrequent for legit users and high reconnect frequency is itself flagged by the per-IP count.

When a budget is exceeded:

1. The triggering `prompt()` call is **dropped** (no LLM call made).
2. A single `{type: "error", message: "rate limit"}` is sent to the client (debounced — don't spam errors if many requests trip the limit during one minute).
3. The Session stays open; once the sliding window relaxes, calls resume normally.
4. If the lifetime cap is hit, no more LLM calls happen on this connection until reconnect. The WS stays open so the client can show their final state.

### 4. Global daily call ceiling (kill switch)

A single counter incremented on every successful Anthropic call. If the counter hits **8000 in a UTC day**, all subsequent `prompt()` calls are rejected with the rate-limit error path above. Counter resets at the next UTC midnight via a one-line check on each call (`if (today !== this.day) { this.day = today; this.count = 0; }`).

Rationale: 8000 calls/day at Opus 4.7 with our short turns is a comfortable cap for organic demo traffic but stops a sustained attack at a single-digit-dollar cost.

## Implementation Sketch

`server/limits.ts`:

```ts
export const ALLOWED_ORIGINS = new Set([
  "https://<app>.fly.dev",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
]);

export const MAX_CONCURRENT_PER_IP = 3;
export const SESSION_RATE_LIMIT_PER_MIN = 8;
export const SESSION_LIFETIME_CAP = 150;
export const GLOBAL_DAILY_CAP = 8000;

export class IpConnectionCounter {
  private counts = new Map<string, number>();
  tryAcquire(ip: string): boolean { /* … */ }
  release(ip: string): void { /* … */ }
}

export class CallBudget {
  private windowStart = 0;
  private windowCount = 0;
  // Sliding window: keep an array of recent timestamps and prune.
  private recent: number[] = [];
  private lifetime = 0;
  consume(now: number): "ok" | "rate" | "lifetime" { /* … */ }
}

export class GlobalCeiling {
  private day = "";
  private count = 0;
  consume(now: Date): "ok" | "exhausted" { /* … */ }
}
```

`server/index.ts` deltas:

- At top of `fetch`: if `pathname === "/ws"`, before `srv.upgrade`, run origin check + IP acquire. On reject, return `Response("forbidden", {status: 403})` or `Response("too many", {status: 429})`. Stash the IP on `ws.data` for the close handler.
- In `close(ws)`: call `ipCounter.release(ws.data.ip)`.

`server/session.ts` deltas:

- Constructor takes a `CallBudget` and a `GlobalCeiling` (or, simpler, a single limits-context object).
- In `prompt()`: before pushing to history, call `budget.consume(Date.now())` and `global.consume(new Date())`. If either rejects, emit one debounced error event and skip the rest.
- The opening greeting goes through the same path; if budget were already 0 at construction it would not fire — but a fresh session always has full budget, so this is a non-issue.

## Testing Strategy

`server/limits.test.ts` (Bun test):

- `IpConnectionCounter`: acquire to limit, next acquire returns false; after release, succeeds again.
- `CallBudget` rate window: 8 consumes in <60s succeed, 9th returns "rate"; after window slide, succeeds again.
- `CallBudget` lifetime: 150 consumes succeed, 151st returns "lifetime".
- `GlobalCeiling`: 8000 consumes succeed, 8001st returns "exhausted"; after day rollover (mock `now`), succeeds again.

Integration smoke (manual, post-deploy):

- Open 4 tabs to the live URL — 4th should fail to connect (network tab shows 429).
- In one tab, send 10 transcripts in <10s — server should log a rate-limit error after the 8th and the puppet should stop responding for the rest of the minute, then resume.
- Check the live URL with `curl` (no `Origin` header) → should get 403 from the upgrade attempt.

## Boundaries

- **Always:** keep all numeric caps as named constants in `limits.ts`, easy to tune. Read the IP only from `Fly-Client-IP` or the well-known fallback header — never trust user-supplied headers like `X-Real-IP`.
- **Ask first:** lowering `GLOBAL_DAILY_CAP` below 1000, adding any auth/login mechanism, switching to per-token (vs per-call) budgeting, persisting counters across redeploys.
- **Never:** log full IPs to stdout (truncate to /24 or hash). Send the API key, headers, or any secret to the client in error messages. Disable the global ceiling.

## Success Criteria

1. ✅ `bun run build` passes.
2. ✅ `bun test` passes including new `limits.test.ts`.
3. ✅ `curl -i -H 'Connection: Upgrade' -H 'Upgrade: websocket' https://<app>.fly.dev/ws` (no Origin) returns 403.
4. ✅ Browser at `https://<app>.fly.dev/` opens a working session (origin allowed).
5. ✅ Opening a 4th simultaneous tab from the same IP fails to connect within ~1 second.
6. ✅ Sending more than 8 transcripts in a minute from one tab triggers the rate-limit error path; recovers after the window passes.
7. ✅ Server logs show no full IP addresses (hashed or truncated).
8. ✅ Memory usage is bounded — `IpConnectionCounter` deletes zero-count keys; `CallBudget` arrays stay <8 entries each.

## Decisions

- Single in-memory limiter, no database.
- Origin check is the primary defense; per-IP and per-session are secondary; global ceiling is the kill switch.
- Calls, not tokens, as the budgeting unit.
- IP from `Fly-Client-IP` only; spoof-resistant given Fly's proxy.

## Decisions (confirmed 2026-04-25)

- NAT tolerance: keep at **3 concurrent connections per IP**. If real demo traffic from a NATted network blocks, tune later.
- **No** friendly user-facing rate-limit message. WS error event is enough; client just logs to console.
- **No** production log redaction in this spec. Out of scope; can be a separate follow-up if/when needed.
