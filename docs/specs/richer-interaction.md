# Spec: Richer Interaction — User Gestures, Pose, Energy, AI Gestures

**Status:** Draft. Awaiting human review.

## Objective

Today the AI puppet *replies* with rich tagged data — `emotion`, `gaze`, `gesture`, `say`. The traffic the other direction is just a transcript and a "user is speaking" flag. The LLM sees what was said but nothing about *how* it was said or what the user's puppet was doing.

This spec adds a symmetric channel: when the user finishes a turn, the client sends the LLM a small `UserSignal` — what gestures the user performed, what pose their puppet is in, and a coarse "energy" hint derived from physical activity. The LLM uses this to craft a reaction the user feels seen by (e.g. waves back when waved at, matches calm/energetic moods, comments on the upside-down puppet). The AI puppet also gains three new physical gestures — `jump`, `spin`, `wiggle` — so it can match the energy.

**Division of labor:** the client only computes signals Claude *can't* see — landmark-based gestures, pose, and embodied energy. Text-based mood/valence is left to Claude itself, which already reads the transcript and is much better at it than a wordlist would be.

**User-visible win:** the AI no longer responds purely to words. It reacts to what your puppet does and how you sound.

## Constraints

The user named these explicitly. Calling them out so design choices flow from them:

- **Simple** — no new ML dependencies, no separate Claude calls for sentiment, no new long-running services.
- **Performant** — detection runs in the existing per-frame loop; the wire only adds a small optional field on existing events.
- **Minimal** — reuse existing patterns (enums in `server/protocol.ts`, gestures table in `puppet-stage.ts`, controller pattern in `src/*-controller.ts`).
- **Reliable** — debounce gestures with confidence thresholds; "missed" gestures are fine, "wrong" gestures are not.

## Tech Stack

No new dependencies.

- Detection: pure-TS heuristics on existing MediaPipe `world` landmarks
- Energy: derived from gesture buffer + hand presence (no text classification on client; text mood is Claude's job)
- AI gestures: same `THREE.Group` rotation/translation pattern already used by `wave` / `nod` etc. in `puppet-stage.ts`

## Wire Protocol Additions

`server/protocol.ts` (typed; both server and client import):

```ts
// One-shot gestures detected by the client. Flat list — no hand
// attribution. The LLM rarely needs to know which hand waved.
export type UserGesture =
  | "thumbs_up" | "peace" | "fist" | "open_palm" | "point" | "wave" | "jump";

// Sustained postural state of the "active" user puppet. Single pose
// (not per-hand). When two puppets are visible, the active one is
// whichever has the highest recent palm motion; when one is visible,
// that one; when none, no pose is reported.
export type UserPose = "normal" | "upside_down" | "sleeping";

// Embodied energy hint derived from gestures + presence. Independent of
// text-based mood, which the server reads from the transcript itself.
export type UserEnergy = "low" | "med" | "high";

// New client event: streams body-language updates as they happen so
// the server has fresh signals for both transcript turns AND idle
// escalations. Each field is optional — clients send only what changed.
export type ClientEvent =
  | { type: "hello" }
  | { type: "transcript"; text: string; final: boolean }   // unchanged
  | {
      type: "signal";
      gestures?: UserGesture[]; // appended to a server-side buffer
      pose?: UserPose;          // replaces server-side current pose
      energy?: UserEnergy;      // replaces server-side current energy
    }
  | ...; // unchanged
```

`Gesture` enum extends with three new AI-puppet gestures (also added to `ACTION_JSON_SCHEMA.enum`):

```ts
export type Gesture =
  | "none" | "wave" | "shrug" | "lean_in" | "nod" | "shake"
  | "jump" | "spin" | "wiggle";
```

**Cadence:** the client streams `signal` events whenever something changes (a gesture fires, pose flips, energy class changes). The server maintains a per-session buffer:

- `pendingGestures: UserGesture[]` — accumulator, drained on each LLM turn
- `currentPose: UserPose` — sticky, last-write-wins
- `currentEnergy: UserEnergy` — sticky, last-write-wins

Both the **transcript final** path and the **idle escalation** path (15s/30s/60s in `server/session.ts`) snapshot this buffer when composing their LLM call. Transcripts include text + signal; escalations are stage-notes + signal.

## Detection Design

### Static hand poses (`thumbs_up`, `peace`, `fist`, `open_palm`, `point`)

Computed from per-finger extension flags. A finger is "extended" if `||tip - wrist|| / ||MCP - wrist|| > 1.7`. Thumb uses a separate angular check because anatomy.

| Gesture | thumb | index | middle | ring | pinky |
|---|---|---|---|---|---|
| thumbs_up | ✓ | – | – | – | – |
| peace | – | ✓ | ✓ | – | – |
| fist | – | – | – | – | – |
| open_palm | ✓ | ✓ | ✓ | ✓ | ✓ |
| point | – | ✓ | – | – | – |

Emit only on a transition into the pose (rising edge), not while held — otherwise the same gesture would spam every frame.

### Dynamic gestures

- **wave** — track lateral palm-X over a rolling 1.5s window; ≥3 zero-crossings of `dx/dt` with amplitude > threshold → emit once, suppress for 1s.
- **jump** — peak detection on palm-Y velocity; positive peak above threshold within ~250 ms followed by negative peak → emit.

### Sustained pose

Single pose for the "active" puppet:

- **Active puppet selection:** if only one puppet is visible, that one. If both, whichever has the higher palm-velocity magnitude over the last ~0.5s. If neither, no pose is reported (the client doesn't send a `pose` field).
- **upside_down** — active puppet's roll within ±0.4 rad of ±π for ≥0.5s.
- **sleeping** — active puppet's palm-position variance under threshold AND mouth-open below 0.1 AND no gestures emitted, sustained for ≥3s.
- otherwise **normal**.

Pose is a sticky classifier — only flip when a different state has held for the required duration. The client only emits a `signal` event when the pose class actually changes (or a gesture fires, or energy class changes). No per-frame chatter.

### Energy

Computed at final-transcript time from the gesture buffer + hand presence. No text analysis on the client — Claude already does that work from the transcript.

- `wave` / `jump` / `open_palm` emitted during the turn → `high`
- any gestures emitted, or a hand visible without dynamic motion → `med`
- `sleeping` pose, or no hand visible → `low`

This is deliberately a coarse, embodied signal. It tells Claude how energetic the *body* is — independent from how energetic the *words* are. Mismatches are interesting (calmly-spoken thumbs-up; energetic hand-flapping while quietly speaking) and Claude can decide which to weight.

## LLM Integration

The session (`server/session.ts`) tracks per-session signal state and snapshots it for every LLM turn — transcript-driven and idle-escalation-driven. The same prompt fragment serves both.

System prompt addition in `server/llm.ts`:

> The client may attach a `signal` block summarizing what the user's body just did. The transcript (or stage-note) still carries the primary content; these are physical/embodied cues.
>  - `gestures`: one-shot actions performed since the last turn (e.g. `["wave"]` — wave back; `["thumbs_up"]` — affirm warmly). Empty / absent = nothing notable.
>  - `pose`: ongoing puppet state of the user's active puppet. `upside_down` or `sleeping` is worth a playful comment. `normal` (or absent) = no comment needed.
>  - `energy`: how energetic the user's body is, independent of their words. Match it (calm with `low`, energetic with `high`) or play off the contrast.
>
> You read text-based mood from the transcript yourself; the client does not pre-classify it. Treat `signal` as advisory cues, not commands.

Where the signal goes per turn type:
- **Transcript turn:** signal snapshot prepended/appended to the transcript text in the user-role message body.
- **Idle escalation turn:** signal snapshot included in the stage-note text. Lets the AI react like *"the puppet has been sleeping for half a minute"* on the 30s escalation.

No separate Claude request, no extra latency, no extra cost — the signal piggybacks on turns that were going to fire anyway.

## AI Puppet Gestures

Three new entries in the `GESTURES` table in `src/puppet-stage.ts`:

- **jump** (`duration: 0.6s`) — body group y-position rises ~0.5 with sin envelope, settles back. Cheap. Reads as excitement.
- **spin** (`duration: 0.9s`) — root rotation.y ramps to 2π over the duration with ease-in-out. Caveat: face is briefly turned away from the viewer (~0.4s). Acceptable for short clips.
- **wiggle** (`duration: 1.0s`) — body group rotates ±0.2 rad in z at ~3 Hz with the existing envelope.

`AiPuppetController` requires no changes — it already routes any `Gesture` value to `model.playGesture`.

## Project Structure

```
src/user-gesture.ts        → NEW. GestureDetector class. Heuristics over landmarks for one hand. Active-puppet selection happens at the call site (main/controller), not inside the detector.
src/user-gesture.test.ts   → NEW. Tests for static-pose classifier, pose stickiness, energy mapping.
src/user-controller.ts     → owns its detector instance; exposes drainGestures(), currentPose, currentEnergy, recentMotion (for active selection).
src/main.ts                → picks the active controller, diffs signal state against last-sent, fires brain.sendSignal({...}) on changes.
src/brain.ts               → grows a sendSignal(partial) method that emits a `signal` event on the wire.
src/puppet-stage.ts        → adds jump/spin/wiggle to the GESTURES table.
server/protocol.ts         → adds UserGesture / UserPose / UserEnergy types; new `signal` ClientEvent variant; extends Gesture enum + ACTION_JSON_SCHEMA.
server/session.ts          → tracks pendingGestures / currentPose / currentEnergy per session; consumes them on transcript-final and on each idle escalation.
server/session.test.ts     → adds cases for signal accumulation + drain on both turn paths.
server/llm.ts              → expands system prompt to consume signal block; takes the signal snapshot as a turn input.
showcase.html / .ts        → buttons render automatically from the Gesture enum.
```

## Code Style

Match existing modules. One snippet to fix the bar:

```ts
// src/user-gesture.ts
export class GestureDetector {
  private palmHistory: { t: number; x: number; y: number }[] = [];
  private lastPose: UserPose = "normal";
  private poseT = 0;
  private cooldown = new Map<UserGesture, number>(); // gesture -> earliest re-emit time

  observe(world: LandmarkList, dt: number): { pose: UserPose; emitted: UserGesture[] } {
    // 1. push palm sample, drop samples older than 1.5s
    // 2. update finger-extension flags
    // 3. classify static pose; emit on rising edge if cooldown elapsed
    // 4. classify dynamic gestures from palmHistory; emit + cooldown
    // 5. classify sustained pose (upside_down / sleeping / normal); flip if held
    // ...
  }
}
```

Keep the detector under ~250 lines. If it grows, split static vs dynamic into two helpers.

## Testing Strategy

- `bun test` for the new + extended modules.
- `src/user-gesture.test.ts` — feed synthetic landmark fixtures (a `world` array with the 21 landmark positions) and assert the right gesture is classified. Cover each of the 5 static poses with at least one positive and one rejecting case. For dynamic gestures, feed a sequence of palmHistory samples and assert wave / jump fire once and respect cooldown. For energy, feed gesture sequences and assert the mapping (`wave` → high; idle hand visible → med; sleeping → low).
- `server/session.test.ts` — extend with two cases: (a) gestures + pose pushed via `signal` events accumulate, are consumed on the next transcript turn, and the buffer drains; (b) the same buffer is consumed on idle escalation and pose persists across escalations until changed.
- No tests for the LLM integration — that path is exercised end-to-end via the running server. We trust Claude to follow the prompt.
- Manual: `bun run dev` + `bun run dev:server`. Show a thumbs-up → AI replies positively. Wave → AI waves back. Flip the puppet, stay silent for 30s → AI's idle escalation comments on the upside-down puppet.

## Boundaries

- **Always:** Run `bun run build && bun test && bun run lint` before committing. Keep detection pure (no scene access from `GestureDetector`). Treat MediaPipe world landmarks as untrusted (any index might be missing in a degenerate frame).
- **Ask first:** Tuning detection thresholds based on user feedback (which usually means a video session, not just numbers). Adding a gesture that requires face landmarks (we'd have to add a new MediaPipe model — separate spec).
- **Never:** Make a separate Claude call for any of these signals. Stream gestures over the WebSocket as standalone events (this spec attaches them to transcripts). Use detection results to *animate* the user puppet differently (the puppet is hand-driven; gesture detection is for the LLM, not for changing visuals). Pre-classify text-based mood on the client — that's Claude's job.

## Success Criteria

1. **Wire format:** `server/protocol.ts` exports `UserGesture`, `UserPose`, `UserEnergy`. A new `signal` `ClientEvent` variant carries optional `gestures` / `pose` / `energy`. `Gesture` includes `jump`, `spin`, `wiggle`. `ACTION_JSON_SCHEMA` mirrors the new gesture enum.
2. **Detection correctness:** Each of the 7 static/dynamic user gestures fires when posed clearly in front of the webcam, doesn't fire on incidental hand motion, and respects its cooldown (no spam).
3. **Pose correctness:** Holding the active hand inverted for >0.5s reports `upside_down`; holding it still + closed for >3s reports `sleeping`. Both flip back to `normal` when the trigger ends. Active-hand selection honors the "highest recent motion" rule when both are visible.
4. **Server buffer:** `server/session.ts` accumulates `gestures` and tracks the latest `pose` / `energy` per session. Both transcript-final and idle-escalation paths consume the buffer; gestures drain on consumption, pose/energy persist.
5. **Energy plumbing:** Streaming a `signal` with `wave` or `jump` results in the next LLM call seeing `energy: "high"`; idle hand presence yields `med`; sleeping or absent hand yields `low`.
6. **LLM responsiveness:** With the new system-prompt fragment, a wave gets a `gesture: "wave"` reply ≥80% of the time; a thumbs-up gets a positive `say` and `emotion: "excited"`-leaning response; an idle escalation while the puppet is `upside_down` produces a comment about it. (Soft target — manually verified across ~10 turns each.)
7. **AI gestures land:** `jump`, `spin`, `wiggle` all play correctly in `/showcase.html`.
8. **No regressions:** Build, tests, lint green. Existing tests (smoothing, gaze hysteresis, brain/session) still pass. Showcase still animates without errors.
9. **Performance:** Frame time impact from `GestureDetector.observe` is < 0.5 ms/frame on a mid-range laptop. The client emits at most a few `signal` events per second under typical use; idle hands produce zero traffic.

## Open Questions

- Detection thresholds (extension ratio of 1.7, jump y-velocity threshold, sleeping motion variance) are first-cut numbers. They'll need a live tuning pass once the code is in. Calling that out as expected, not as a blocker.
- The `spin` gesture briefly hides the puppet's face. Confirming that's acceptable; if not, swap it for a "hop" or a half-rotation.

---

## Implementation Plan (Phase 2)

### Component map

```
server/protocol.ts (types)
    │
    ├─→ src/user-gesture.ts (detector, pure)
    ├─→ src/puppet-stage.ts (jump/spin/wiggle clips)
    ├─→ src/brain.ts (sendSignal)
    └─→ server/session.ts (signal buffer)
              │
              └─→ server/llm.ts (prompt + turn body)

src/user-gesture.ts ─→ src/user-controller.ts ─┐
                                                ├─→ src/main.ts (active-hand selection, diff & send)
src/brain.ts ──────────────────────────────────┘
```

### Build order

**Slice 1 — foundations (parallel-safe).** No cross-dependencies; each can land alone.
1. `server/protocol.ts` — add types, extend `Gesture`, mirror in `ACTION_JSON_SCHEMA`. Compiles whole repo even before consumers exist.
2. `src/puppet-stage.ts` — add `jump` / `spin` / `wiggle` to the `GESTURES` table. Verify in `/showcase.html` (existing buttons pick up new enum values automatically).
3. `src/user-gesture.ts` + `src/user-gesture.test.ts` — detector class + unit tests. Pure heuristics, no DOM/three.js dependencies. Tests cover the 5 static poses (positive + reject), 2 dynamic gestures (fire + cooldown), pose stickiness, energy mapping.

Verification gate: `bun run build && bun test && bun run lint` green.

**Slice 2 — server-side buffer.** Depends on slice 1.1.
4. `server/session.ts` — add `pendingGestures` / `currentPose` / `currentEnergy` to the per-session state. Wire the new `signal` event handler to mutate them. Snapshot+drain on transcript-final; snapshot on idle escalation (without draining pose/energy — those are sticky).
5. `server/session.test.ts` — two new cases per the testing strategy.
6. `server/llm.ts` — extend system prompt with the signal-block guidance; accept the snapshot as a turn input and inject it into the user-role / stage-note message body.

Verification gate: server tests pass; manually fire a `signal` ws message via `wscat` or a quick curl-style script; confirm the LLM prompt now includes the block.

**Slice 3 — client integration.** Depends on slices 1.1, 1.3, 2.
7. `src/brain.ts` — add `sendSignal(partial)` method that sends a `signal` event. No queueing logic — caller's job to debounce.
8. `src/user-controller.ts` — instantiate a `GestureDetector`, drive it from `update()`, expose `drainGestures()` / `currentPose` / `currentEnergy` / `recentMotion` getters.
9. `src/main.ts` — once per frame: pick the active controller (highest `recentMotion` among visible; else single-visible; else null). Compose the candidate signal (drained gestures + active pose + active energy). Diff against the last-sent signal; on change, call `brain.sendSignal({...diff})`.

Verification gate: open `/`, talk to the AI normally, watch the dev tools network panel — `signal` events fire on gesture/pose/energy changes only. No frame-rate spam.

**Slice 4 — end-to-end.** Depends on all of the above.
10. Manual smoke: wave → AI waves back. Thumbs-up → positive `say` + excited emotion. Flip puppet, stay silent for 30s → idle escalation comments on the upside-down puppet. `jump`/`spin`/`wiggle` come through when the LLM picks them.
11. Tune thresholds based on what the live test surfaces. Commit.
12. Deploy + smoke on prod.

### Parallelism

Slices 1.1, 1.2, 1.3 are independent and could be three concurrent edits. After slice 1 lands, slices 2 and 3 can also progress in parallel up until step 9 (which needs both done). For a single agent, I'll do them sequentially in the order above — the parallelism is just a property of the dependency graph, not a requirement.

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| Detection false positives (LLM reacts to gestures the user didn't do) | Cooldowns per gesture (≥1s between same-gesture re-emits); rising-edge detection only; conservative thresholds with a planned live tuning pass at step 11 |
| `signal` traffic explosion | Diff in `main.ts` before calling `sendSignal`; gestures are emitted only on rising edges; pose/energy only on class change |
| Active-hand thrashing when both hands have similar motion | Hysteresis: keep the current active hand unless the other's motion exceeds it by ≥1.5× for ≥0.5s |
| `spin` clip rotating root.y while controller calls `setRoll` (root.z) | They operate on different axes; verified compatible. The gesture clip should reset its transforms each frame anyway (matches the existing pattern in `GESTURES`) |
| Idle escalations repeat the same pose comment three times (15s, 30s, 60s) | Include a "you've already commented on this pose" hint in the escalation prompt body when the pose hasn't changed since the last escalation; keep server logic stateless otherwise |
| Prompt cache invalidation from new system prompt content | The new system-prompt fragment is appended once, becomes part of the cached prefix; per-turn signal block goes in the user-role body which isn't cached anyway. Should not affect cache hit rate |
| Per-session signal state leaking across reconnects | The session is keyed to the WebSocket; reconnect = fresh session. Already the case for everything else. Add an explicit test |

### Verification checkpoints

- After slice 1: tests pass; `/showcase.html` plays the three new AI gestures cleanly.
- After slice 2: server tests pass for buffer accumulate/drain on both turn paths; a manually-injected `signal` event is reflected in the next outgoing prompt.
- After slice 3: gesture/pose/energy changes produce exactly one `signal` ws frame each on the client.
- After slice 4: manual end-to-end smoke matches the success criteria (waves back, comments on upside-down at idle escalation, `spin` reads on stage).
