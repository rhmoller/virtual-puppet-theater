# Spec: MVP Hardening

## Objective

Fix the six highest-value issues surfaced in the end-to-end-MVP code review.
Goal is a shippable prototype: correctness bugs eliminated, external
dependencies pinned, internal modules sized for maintenance. Behavior stays
the same for the happy path; the app becomes more robust when things go
slightly wrong (fast user turns, CDN compromise, browser resize, LLM
truncation).

Users and scenarios unchanged — a kid with a webcam, one or two hands on
stage, the AI puppet reacting. Success is that nobody notices a difference except
the maintainer, who now has tests and a more navigable `main.ts`.

## Scope — six items

### 1. Collapse pending turns when LLM is in-flight (server)

**Problem.** `Session.prompt()` drops turns on the floor when `inFlight === true`: the turn is pushed to history but no follow-up is generated when the in-flight call completes. A user transcript arriving during the 1–3 s Anthropic round-trip is silently swallowed.

**Resolution.** Append turns to `history` regardless of `inFlight`. When an in-flight call completes, check whether new user-role turns were appended since it started; if so, fire exactly one follow-up prompt with the latest state. Never run two LLM calls in parallel; never queue multiple follow-ups (collapse into one).

**Files:** `server/session.ts`.

**Success criteria:**
- `SESSION-1`: Given an in-flight prompt, when a new user turn arrives, it is preserved (queued or appended) and visible to the next LLM call.
- `SESSION-2`: When the in-flight prompt resolves, the most recent user turn has been responded to exactly once.
- `SESSION-3`: Multiple user turns arriving during a single in-flight window produce exactly one follow-up response (not N).
- `SESSION-4`: Idle-escalation prompts do not queue themselves while `inFlight`.

### 2. Raise `max_tokens` on the Anthropic call (server)

**Problem.** `max_tokens: 400` with JSON wrapping can truncate longer kid-friendly replies, producing invalid JSON and an error event to the client.

**Resolution.** Set `max_tokens: 600`. No retry logic. If truncation still occurs in practice, revisit.

**Files:** `server/llm.ts`.

**Success criteria:**
- `LLM-1`: `max_tokens` is 600 in `AnthropicBackend.generateAction`.

### 3. Pin MediaPipe CDN with SRI (frontend)

**Problem.** `index.html` loads `https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js` unpinned and without integrity. A compromised CDN or MITM would run arbitrary JS in our origin with webcam + mic access.

**Resolution.** Pin to `@mediapipe/hands@0.4.1675469240` (matches `package.json`), add `integrity="sha384-…"` on the script tag. The WASM / tflite assets loaded via `locateFile` (`hands_solution_simd_wasm_bin.*`, `hands.binarypb`) are browser-fetched and validated by the cross-origin-isolated context; we do not add SRI for those (SRI isn't wired through MediaPipe's `locateFile`).

**Files:** `index.html`.

**Success criteria:**
- `CDN-1`: Script URL contains `@0.4.1675469240`.
- `CDN-2`: Script tag has `integrity` and `crossorigin` attributes.
- `CDN-3`: The app still loads (manual check).

### 4. Add `Brain.stop()` lifecycle (frontend)

**Problem.** `Brain.start()` arms a `setInterval` and a reconnecting `WebSocket` with no way to shut them down. Harmless today (single SPA, never unmounts), but blocks test setup and HMR safety.

**Resolution.** Store the interval handle; add `stop()` that clears it, closes the socket, and sets a `stopped` flag the reconnect path checks. Not called from production code — this is a hook for future tests.

**Files:** `src/brain.ts`.

**Success criteria:**
- `BRAIN-1`: `Brain.stop()` exists.
- `BRAIN-2`: After `stop()`, no further `setInterval` callback runs.
- `BRAIN-3`: After `stop()`, the `close` handler does not reconnect.

### 5. Split `src/main.ts` (frontend)

**Problem.** `main.ts` is 698 lines mixing scene bootstrap, render loop, MediaPipe wiring, landmark debug rendering, TTS queue/voice/unlock, welcome utterance, and Brain wiring. Painful to navigate and review.

**Resolution.** Extract into three siblings, leave `main.ts` as bootstrap + render loop:

- `src/speech.ts` — `pickStageVoice`, `speakNow`, `speak`, voice/unlock queue. Exports `speak(text: string)` and `installSpeechUnlock()` (wires gesture listeners). Owns all TTS globals.
- `src/welcome.ts` — `announceWelcome()` and its gesture-fallback timer.
- `src/landmarks.ts` — `drawHandLandmarks`, `drawLandmarks`, landmark canvas setup.

`main.ts` retains: renderer/scene/camera setup, resize, puppet/ragdoll/stage-puppet instantiation, the `frame()` loop, `applyAction`, Brain instantiation, camera init IIFE, loader tick, debug key binding.

No behavior change. No `console.log` gating in this item (that's follow-up work).

**Files:** `src/main.ts`, new `src/speech.ts`, new `src/welcome.ts`, new `src/landmarks.ts`.

**Success criteria:**
- `SPLIT-1`: `main.ts` is < 450 lines (originally 698). Landed at 441 — the sub-400 target was relaxed at review time to avoid forcing an extraction beyond a natural boundary.
- `SPLIT-2`: Each new file has a single, nameable concern.
- `SPLIT-3`: `bun run build` succeeds. App behaves identically in manual smoke test (loader → welcome line → hand raises → puppet on stage → AI puppet reacts).

### 6. Debounce `Theater.layout()` on resize (frontend)

**Problem.** Every window resize triggers `theater.layout()`, which clears and rebuilds valance, curtains, ornaments, and ~100 merged bead geometries. Rapid drag-to-resize causes visible hitches.

**Resolution.** Debounce the `resize` handler in `main.ts` to a 120 ms trailing call before invoking `theater.layout()`. Renderer size and camera aspect update immediately (cheap); only the theater rebuild is debounced.

**Files:** `src/main.ts`.

**Success criteria:**
- `RESIZE-1`: Rapid window resize triggers at most one `theater.layout()` call per 120 ms window.
- `RESIZE-2`: On settled resize, the theater matches the viewport within 200 ms.
- `RESIZE-3`: Renderer canvas size updates live during drag.

## Tech Stack

Unchanged:
- Bun runtime + package manager
- Vite 8 + TypeScript 6 (strict, bundler resolution)
- Three.js 0.184
- `@mediapipe/hands` 0.4.x (CDN for runtime, npm for types)
- `@anthropic-ai/sdk` 0.91.x, `claude-opus-4-7`

Added:
- **Bun's built-in test runner** (no dependency). `bun test` is the runner.

## Commands

```
bun run dev         # Vite dev server (frontend)
bun run dev:server  # Bun server with --hot
bun run build       # tsc && vite build
bun run preview     # preview prod bundle

bun test            # run all tests (ADDED in this sprint)
bun test --watch    # watch mode
```

A `test` script gets added to `package.json` that maps to `bun test`.

## Project Structure

```
server/
  index.ts          WebSocket server (unchanged)
  llm.ts            Anthropic backend (item 2)
  protocol.ts       Wire types + ACTION_JSON_SCHEMA (unchanged)
  session.ts        Chat session & idle logic (item 1)
  session.test.ts   NEW — item 1 behavior tests
src/
  brain.ts          WebSocket client + STT (item 4)
  brain.test.ts     NEW — item 4 lifecycle test
  clawd.ts          Legacy mascot rig (unchanged)
  landmarks.ts      NEW — debug landmark canvas (item 5)
  main.ts           Bootstrap + render loop (items 5, 6)
  puppet.ts         Puppet rig (unchanged)
  ragdoll.ts        Verlet physics (unchanged)
  speech.ts         NEW — TTS voice/queue/unlock (item 5)
  theater.ts        Stage frame (unchanged)
  welcome.ts        NEW — welcome utterance (item 5)
index.html          Entry + CDN script (item 3)
docs/specs/
  mvp-hardening.md  This spec
```

## Code Style

Follow the existing code. No new conventions introduced by this sprint.
Concrete reminders:

- **TypeScript strict, bundler resolution**, `.ts` extensions on imports (matches `server/*.ts` imports in frontend files).
- **No classes for new modules unless they hold state** — `speech.ts`, `welcome.ts`, `landmarks.ts` export functions with module-level state (mirrors the current pattern of `pickStageVoice` + `speakNow` living at module scope in `main.ts`).
- **`console.log("[tag]", …)` logging** stays as-is (gating is a follow-up).
- Match the existing indentation (2 spaces), trailing commas, double quotes.
- No semicolons? — the project uses semicolons. Keep them.

Example new-file shape (`src/speech.ts` sketch):

```ts
// src/speech.ts — Stage-puppet TTS. Handles browser voice list loading, the
// autoplay-policy gesture unlock, and queuing utterances that arrive
// before both are ready.
let speechUnlocked = false;
let voicesReady = (window.speechSynthesis?.getVoices().length ?? 0) > 0;
const pendingSpeech: string[] = [];

export function speak(text: string) { /* ... */ }
export function installSpeechUnlock() { /* wires pointerdown/keydown/touchstart */ }
export function cancelSpeech() { window.speechSynthesis?.cancel(); }
```

## Testing Strategy

**Runner:** `bun test`. Tests live alongside source as `*.test.ts` (Bun discovers them automatically).

**Where tests are required:**
- `server/session.test.ts` — SESSION-1..SESSION-4. Stub the `LLMBackend` interface with a fake that returns a canned `Action` after a controllable delay; drive events through `Session.handle`.
- `src/brain.test.ts` — BRAIN-1..BRAIN-3. Stub `WebSocket` with a minimal fake (just `readyState`, `send`, `close`, add/remove listeners). Use `bun:test` fake timers for the interval check.

**Where tests are not required in this sprint:**
- `server/llm.test.ts` — item 2 is a one-line constant change; covered by `bun run build`.
- `src/speech.test.ts`, `src/welcome.test.ts`, `src/landmarks.test.ts` — item 5 is a pure refactor; validated by manual smoke test + build.
- `src/main.test.ts` — resize debounce verified by manual check + a single logic-level test would require extracting the debounce utility (over-engineering).

**Coverage target:** no numeric target. Every success criterion with a file-level behavior (SESSION-1..4, BRAIN-1..3) has at least one test.

**Test style:** DAMP. Each test is self-contained, one assertion per concept, descriptive name (`"queues a new user turn arriving while a prompt is in flight"` over `"test session flow"`).

**Manual verification checklist** (per PR, before merge):
- `bun run build` succeeds.
- `bun test` passes.
- Local smoke: loader completes → welcome line plays → raise a hand → puppet appears → AI puppet reacts within ~3 s → speak → AI puppet replies.
- Resize window fast: no hitching (item 6 specific).

## Boundaries

**Always:**
- Run `bun run build` and `bun test` before committing.
- One commit per item (per conventional-commits style from CLAUDE.md); no mixing items in a single changeset.
- Preserve existing behavior on the happy path. Any behavior change beyond the success criteria in this spec is out of scope and gets a separate spec.

**Ask first:**
- Adding any new runtime dependency (spec adds zero; Bun test is built in).
- Changing the wire protocol (`server/protocol.ts`) — downstream impact on both sides.
- Changing `ACTION_JSON_SCHEMA` or its enums.
- Touching files not listed in this spec's Scope section.

**Never:**
- Commit secrets or an `.env` with the Anthropic key.
- Remove or skip failing tests to make the suite pass.
- Delete `CLAUDE.md`, `README.md`, or `LICENSE`.
- Use `--no-verify` on commits.
- Land a refactor and a behavior change in the same commit (splits item 5 from any of 1/2/3/4/6).

## Success Criteria (overall)

- All 14 per-item success criteria above (`SESSION-1..4`, `LLM-1`, `CDN-1..3`, `BRAIN-1..3`, `SPLIT-1..3`, `RESIZE-1..3`) pass.
- `bun test` runs and passes, with tests covering `Session` collapse behavior and `Brain.stop()` lifecycle.
- `bun run build` succeeds after every item.
- Manual smoke test passes on the final merged branch (loader → welcome → hand → puppet → speech → reply).
- `src/main.ts` line count drops below 450 (achieved: 441, down from 698).
- `end-to-end-mvp` tag still points at the prior commit; a new `end-to-end-mvp-hardened` tag is placed on the final commit.

## Open Questions

Resolved in the plan phase:
1. Order: test infra → 1 → 2 → 4 → 3 → 5 → 6.
2. Bun-test-setup lands as its own task at the head of the sprint.
3. SRI hash values computed at task 5 implementation time.

## Tasks

Ordered by dependency. No task modifies more than four files. Every task
ends with a green `bun run build` and, where tests exist, green `bun test`.

### Task 0 — Bun test scaffold

Stand up the test runner before any test-dependent work.

- **Acceptance:**
  - `package.json` has a `"test": "bun test"` script.
  - One passing sanity test exists (`tests/sanity.test.ts`, kept as a canary — it verifies the runner, test discovery, and basic assertion work).
  - If `bun test` can't resolve the project's `.ts` imports, fall back to Vitest and record the decision in this spec before continuing.
- **Verify:**
  - `bun test` → exit 0, one test reported passing.
  - `bun run build` still succeeds.
- **Files:** `package.json`, new `tests/sanity.test.ts`.

### Task 1 — Session in-flight collapse (+ SESSION-1..4 tests)

Red-first: write the four failing tests, then implement.

- **Acceptance:**
  - `server/session.test.ts` exists with tests for SESSION-1..4.
  - All four fail against the pre-change implementation and pass after. (Run the suite against current `session.ts` before changing it to confirm RED.)
  - Implementation uses a single collapse check in the `prompt` `finally` path — no background queues, no interval, no timers.
  - Idle-escalation path (`checkIdle` → `prompt`) benefits from the same collapse (SESSION-4).
- **Verify:**
  - `bun test` passes.
  - `bun run build` passes.
  - Manual smoke: speak a short sentence, AI puppet replies within ~3 s.
- **Files:** new `server/session.test.ts`, `server/session.ts`.

### Task 2 — `max_tokens` bump

- **Acceptance:** `max_tokens: 600` in `AnthropicBackend.generateAction`.
- **Verify:**
  - `bun run build` passes.
  - Manual smoke: one round-trip produces a non-truncated reply.
- **Files:** `server/llm.ts`.

### Task 3 — `Brain.stop()` + BRAIN-1..3 tests

- **Acceptance:**
  - `src/brain.test.ts` exists with tests for BRAIN-1..3.
  - Tests use a minimal `FakeWebSocket` (local fixture) and `bun:test` timer utilities.
  - `Brain.stop()` clears the flush interval, closes the socket, and sets a `stopped` flag that short-circuits the reconnect callback *at the moment it fires* (not just at `stop()` call time).
- **Verify:**
  - `bun test` passes.
  - `bun run build` passes.
  - Manual smoke: app still connects, receives actions, reconnects after killing the server briefly.
- **Files:** new `src/brain.test.ts`, `src/brain.ts`.

### Task 4 — CDN pin + SRI

- **Acceptance:**
  - Script URL in `index.html` is `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js`.
  - `integrity="sha384-…"` attribute set with the correct hash for that exact file (computed via `curl … | openssl dgst -sha384 -binary | openssl base64 -A`).
  - `crossorigin="anonymous"` retained.
- **Verify:**
  - Hard-reload the app in the browser. Loader completes; raising a hand produces a puppet (proves MediaPipe actually loaded, not SRI-blocked).
  - DevTools Console free of SRI integrity errors.
- **Files:** `index.html`.

### Task 5 — Split `src/main.ts`

Pure refactor. No behavior changes, no logging changes, no type changes.

- **Acceptance:**
  - New files: `src/speech.ts`, `src/welcome.ts`, `src/landmarks.ts`.
  - `src/main.ts` ≤ 400 lines (`wc -l src/main.ts`).
  - Each new file has a single concern, named in its top-of-file comment.
  - Listener registration order preserved for the TTS unlock handlers (autoplay-policy behavior must not change).
  - `applyAction`, Brain instantiation, camera init IIFE, render loop, resize handler all remain in `main.ts`.
- **Verify:**
  - `bun run build` passes.
  - `bun test` passes (no new tests; existing ones still green).
  - Full manual smoke: loader → welcome line plays on first click → raise hand → puppet appears → speak → AI puppet replies with gesture + emotion.
- **Files:** `src/main.ts`, new `src/speech.ts`, new `src/welcome.ts`, new `src/landmarks.ts`.

### Task 6 — Debounce `Theater.layout()` on resize

- **Acceptance:**
  - The `resize` handler in `main.ts` updates renderer size + camera aspect immediately and debounces the `theater.layout(...)` call with a 120 ms trailing delay.
  - Implementation is local (small helper or inline `setTimeout`/`clearTimeout`) — no new module, no debounce dependency.
- **Verify:**
  - `bun run build` passes.
  - Manual: drag the window edge for 2 seconds. No visible theater hitching; renderer canvas follows the drag live. On release, the theater frame settles within ~200 ms.
- **Files:** `src/main.ts`.

### Task 7 — Final smoke test and tag

- **Acceptance:**
  - End-to-end manual smoke test from a clean `bun run dev:server` + `bun run dev`: loader completes → welcome line → raise a hand → puppet → speak → AI puppet responds (say + emotion + gesture) → lower hand → AI puppet slides onstage.
  - Annotated git tag `end-to-end-mvp-hardened` placed on the final commit.
- **Verify:**
  - `git tag --list | grep end-to-end-mvp-hardened` prints the tag.
  - `bun test` and `bun run build` both green on the tagged commit.
- **Files:** none (git tag only).
