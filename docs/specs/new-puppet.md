# Spec: New Stage Puppet (replacing Clawd)

**Status:** Complete (commits `52f9ebb`, `e903ca9`). Success criteria 1–5 verified; 6 and 7 accepted on review.

## Objective

Replace Clawd on stage with an original, trademark-safe puppet so the project can be shown publicly without IP risk. Clawd stays in the repo and becomes a future easter egg (not wired up in this task).

The new puppet is a **simplified, stylized colorful human in the tradition of hand/foam-rubber puppetry** — expressive, cartoony, kid-facing. It must look clearly "ours," not a pastiche of any specific Jim Henson character.

User-visible behavior is otherwise unchanged: the same emotions, gazes, gestures, and speaking lip-sync work with the same brain/protocol.

## Tech Stack

No new dependencies. Same as Clawd:

- Three.js primitives (`BoxGeometry`, `SphereGeometry`, `CapsuleGeometry`, `CylinderGeometry`)
- `MeshStandardMaterial` for PBR shading
- Arm animation is sin-wave driven on simple `Group` nodes, matching Clawd's pattern. `Ragdoll` (`src/ragdoll.ts`) is **not** reused — it is coupled to the hand-tracked `Puppet` class and is a separate concern.

## Commands

- Dev: `bun run dev`
- Build: `bun run build`
- Preview: `bun run preview`
- Tests: `bun test`
- Showcase (emotions/gazes/gestures grid): open `/showcase.html` under dev server

## Project Structure

```
src/clawd.ts         → untouched (future easter egg, not imported by main)
src/puppet-stage.ts  → NEW — the replacement puppet class
src/puppet-stage.test.ts → NEW — unit tests
src/main.ts          → swap import + rename local var; extended to pass glanceY
src/showcase.ts      → swap import; extended to pass glanceY
showcase.html        → removed stale "up/down has no visual effect" hint
src/ragdoll.ts       → untouched (coupled to hand-tracked Puppet, not reused here)
src/puppet.ts        → untouched (hand-tracked mini puppet, different concern)
server/protocol.ts   → untouched (emotions/gazes/gestures enums unchanged)
docs/specs/new-puppet.md → this file
```

Class name: `StagePuppet` (neutral, no character name baked into code — makes future swaps easy).

## Character Design

**Silhouette.** Stylized human child/adult-neutral. Roughly:

- **Head:** large sphere (~1.4× body width), slight vertical squash. Dominant on-screen.
- **Torso:** short capsule, solid-color "shirt."
- **Arms:** two simple arm groups hanging from the torso, sin-wave animated like Clawd's, terminating in small sphere hands.
- **No legs visible.** Puppet is framed chest-up like a hand puppet behind a stage edge.
- **Hair:** a chunky geometric cap on top of the head (e.g. a half-sphere or a few stacked boxes) in a contrasting bright color — reads as "haircut" without any recognizable character silhouette.

**Face.**

- **Eyes:** two white spheres with dark pupil spheres set slightly forward. Pupils shift on both X and Y with the gaze bias.
- **Eyebrows:** two small thin dark boxes above the eyes. Vertical offset + rotation drive most of the emotion readout (inner-down/outer-up for smug, raised-high for surprised, etc.).
- **Mouth:** a single dark flattened ellipse (squashed sphere). **Hidden at rest**, same as Clawd; y-scale opens it when `setSpeaking(true)`. Emotions do NOT drive mouth shape — readout comes from eyes, brows, and body sway.
- **Nose:** small lavender-ish sphere between eyes and mouth, pushed slightly forward so it reads as a distinct feature.
- **Hair:** short teal dome cap covering the top of the head, with a small forward fringe. Forehead skin is visible between hair and brows.

**Palette (trademark-safe, intentionally unlike common Muppet colors).**

- Skin: pastel lavender (`#c9b7e8`). Non-naturalistic on purpose; avoids race-coding a cartoon human AND avoids Kermit-green / Piggy-pink territory.
- Shirt: warm mustard (`#e0a244`).
- Hair: deep teal (`#128a8a`).
- Eye whites: off-white (`#f5f1e8`); pupils, brows, and mouth share the same near-black (`#1a1410`).

**Legal guardrails (explicit non-goals).**

- Not green + long thin body (Kermit)
- Not pink + blonde hair + female-coded (Piggy)
- Not orange + wild hair (Beaker / Animal)
- Not blue + large hooked nose (Gonzo / Grover)
- Not red + bushy unibrow (Elmo)
- No felt/fuzz fur texture that reads as a specific Henson creature
- No "hinged full-head jaw" as the sole mouth — use a distinct lip shape

If a reasonable observer could name a specific existing puppet character from a screenshot, redesign.

## Public Interface

`StagePuppet` must be drop-in compatible with `Clawd` for `main.ts` and `showcase.ts`:

```typescript
export class StagePuppet {
  readonly root: THREE.Group;
  setEmotion(e: Emotion): void;
  playGesture(g: Gesture): void;
  setSpeaking(on: boolean): void;
  update(dt: number, glanceX?: number, glanceY?: number): void;
}
```

The trailing `glanceY` argument is new — Clawd's `update(dt, glanceX)` ignored vertical gaze; the new puppet tilts its head and shifts pupils vertically when `glanceY ≠ 0`.

Enums imported unchanged from `server/protocol.ts`:

- `Emotion = 'neutral' | 'smug' | 'curious' | 'excited' | 'bored' | 'surprised'`
- `Gaze = 'user' | 'away' | 'up' | 'down'` — `GAZE_TO_BIAS` in `main.ts` and `showcase.ts` was widened from `Record<Gaze, number>` to `Record<Gaze, { x: number; y: number }>` so `up`/`down` actually move the puppet.
- `Gesture = 'none' | 'wave' | 'shrug' | 'lean_in' | 'nod' | 'shake'`

## Behavior Parity Requirements

### Emotions

Each emotion modulates a set of continuous parameters, smoothly interpolated (same `tau ~300ms` feel as Clawd). New parameters on top of Clawd's:

| Emotion   | Eyes        | Brows                      | Body sway      | Head tilt |
|-----------|-------------|----------------------------|----------------|-----------|
| neutral   | normal      | flat                       | slow gentle    | 0         |
| smug      | squint (scaleY 0.75)  | inner-down, outer-up | slow     | +slight right |
| curious   | wide (scaleY 1.1) | both raised           | slow           | head tilt |
| excited   | wide (scaleY 1.15) | both raised           | fast/high      | bouncy    |
| bored     | half-lid (scaleY 0.55) | flat, inner-down   | slow/low       | slumped   |
| surprised | wide (scaleY 1.5) | both raised high       | paused briefly | 0         |

The body-sway / rock / blink-rate inputs from Clawd's `EMOTION_PARAMS` are reused; brows and head tilt are new. Mouth shape is NOT emotion-driven (the mouth is hidden while silent).

### Gazes

`update(dt, glanceX, glanceY)` reads both components of the gaze bias. Horizontal gaze shifts pupils along X; vertical gaze shifts pupils along Y and tilts the head about X (positive Y = look up = head tilts back). Bias values are clamped to `-1..1` per axis.

### Gestures

Same six one-shots (`none`, `wave`, `shrug`, `lean_in`, `nod`, `shake`), same durations (0.7–1.2s), same overlay-on-idle behavior. Each animates different parts:

- `wave` — one arm lifted (rotation.z) with a wrist oscillation (rotation.x) at ~2.5 Hz.
- `shrug` — both arms lift and rotate outward; body drops slightly.
- `lean_in` — body translates forward + scales up slightly.
- `nod` — head rotation.x oscillates at ~2.5 Hz.
- `shake` — head rotation.y oscillates at ~4.3 Hz.

### Speaking

`setSpeaking(on)` drives an envelope identical to Clawd's (smoothed ~90ms). When envelope > 0:

- Mouth becomes visible; y-scale pulses at 4.2 Hz between a thin line and the full ellipse.
- Subtle head micro-nod on rotation.x.
- Arm wiggle amplitude scales ×(1 + env × 0.4).

When envelope = 0, mouth is hidden (matches Clawd exactly). Emotion has no effect on mouth shape; emotion readout comes from eyes, brows, head tilt, and body sway.

## Integration Points

Two import swaps plus the gaze-bias widening:

1. `src/main.ts` — `Clawd` → `StagePuppet`; local var `clawd*` → `stagePuppet*` (including `updateClawd` → `updateStagePuppet`). `GAZE_TO_BIAS` widened to `{x, y}`; brain-driven gaze split into `brainGazeX`/`brainGazeY`.
2. `src/showcase.ts` — `Clawd` → `StagePuppet`; `GAZE_TO_X` → `GAZE_TO_BIAS` with `{x, y}`; `puppet.update(dt, bias.x, bias.y)`.
3. `showcase.html` — removed the "up / down currently have no visual effect" hint (no longer true).

`src/clawd.ts` is **not** deleted or edited. It remains importable for the future easter egg.

## Testing Strategy

- **`src/puppet-stage.test.ts`** (new) — unit tests in Bun. Cover:
  - Construction produces a `THREE.Group` with the expected rig children.
  - `setEmotion('surprised')` widens the eye scale after several update ticks.
  - `playGesture('wave')` runs without error across the gesture duration and beyond.
  - `setSpeaking(true)` makes the mouth visible and opens it (scale.y > 0); `setSpeaking(false)` decays the envelope until the mouth is hidden again.
- **Showcase page (`/showcase.html`)** — manual visual check: every emotion × gaze × gesture combo renders without errors, face reads as intended emotion.
- **Type check:** `bun run build` must pass.

No ragdoll regression tests — that module is untouched.

## Boundaries

- **Always:** reuse existing enums from `server/protocol.ts`; keep `Ragdoll` as-is; keep the public interface drop-in compatible.
- **Ask first:** changing `Emotion`/`Gaze`/`Gesture` enums; adding new brain-level actions; touching `src/ragdoll.ts`; deleting `src/clawd.ts`.
- **Never:** import any Muppet-adjacent assets, textures, or sounds; introduce named character IP in code; commit without explicit user request.

## Success Criteria

1. ✅ `src/clawd.ts` unchanged on disk (empty `git diff src/clawd.ts`).
2. ✅ `bun run build` passes.
3. ✅ `bun test` — 13/13 pass, including 4 in `puppet-stage.test.ts`.
4. ✅ `/showcase.html` renders the new puppet; emotions, gazes (incl. up/down), gestures, and speaking verified visually.
5. ✅ Live stage (`/`) verified end-to-end with webcam + brain (user-confirmed).
6. ✅ Design is a stylized colorful human that does not read as any specific Jim Henson character (accepted on review).
7. ✅ `StagePuppet` is a drop-in for `Clawd`: same public surface plus an optional `glanceY` argument; reverting the two imports would restore prior behavior.

## Decisions (confirmed 2026-04-24)

- Skin: **lavender `#c9b7e8`**.
- Design is **gender-neutral** (short hair, neutral shirt).
- Clawd easter-egg trigger is **out of scope** for this task; will be specced separately.
- Mouth: **dark, hidden at rest** (matches Clawd exactly). Emotions do not shape the mouth; readout lives in eyes, brows, head tilt, body sway.
- `update()` gains an optional `glanceY` so `up`/`down` gaze is visible (head tilt + pupil shift). `Clawd.update()` retains its 2-arg signature and is not called by anything.
