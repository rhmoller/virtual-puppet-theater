# Paper cut — variant 1

Draft plan for the 3-minute hackathon submission video. Captures
structural decisions, VO script with timing, and recording notes.

## Constraints and decisions

- **Length:** 2:30 hard target (the brief allows up to 3:00, but a
  tight 2:30 likely scores better).
- **Tone:** sincere wonder. Calm narration with quiet emotional weight
  on the wow beats. Aligns with the *Most Creative Opus 4.7* prize
  rubric, which rewards projects "with a voice."
- **Audio:** scripted voiceover (adult) + in-app audio (the AI
  puppet's TTS via ElevenLabs flash, user STT) ducked underneath.
  Music bed light, room for silence.
- **On camera:** no webcam feed except for one short hands-only
  insert that establishes the MediaPipe input. No faces shown.
- **Voices on stage:** kid drives the imagination half (naming +
  scene placement + money shot). Adult bookends (setup VO, catalog
  asks, cache flex, close). The voice change does the narrative
  handoff implicitly.
- **Money-shot prop:** whatever the kid asks for in his takes.
  `[PROP]` is a placeholder until recording. With the better asset
  generator (correct primitive scales, connectedness rules, 14
  primitives), 1–2 back-to-back asks are realistic — go for variety
  if takes give it.
- **Puppet name:** the AI puppet is nameless by default; the kid
  names it in-session and the LLM adopts the name. `[NAME]` in the
  script is a placeholder for whatever the kid actually picks.
- **Recording order:** kid first (scheduling constraint, multiple
  takes while he's having fun), adult after (matches the takes that
  exist).

## Structural shape

| #  | Beat                       | Time          | Driver  |
|----|----------------------------|---------------|---------|
| 1  | Cold open / sizzle         | 00:00–00:10   | mixed   |
| 2  | Title card                 | 00:10–00:14   | —       |
| 3  | Hands-only establishing    | 00:14–00:18   | —       |
| 4  | Setup + naming             | 00:18–00:35   | kid     |
| 5  | Catalog dressing           | 00:35–00:55   | adult   |
| 6  | Scene placement            | 00:55–01:15   | kid     |
| 7  | Money shot                 | 01:15–02:00   | kid     |
| 8  | Cache flex                 | 02:00–02:20   | adult   |
| 9  | Close + end card           | 02:20–02:30   | —       |

## Beat-by-beat with VO

VO speaking rate target: ~140 wpm (2.3 words/sec). Word counts noted.
`[NAME]` = the in-session name the kid gave the puppet. `[PROP]` =
the off-catalog prop the kid asked the puppet to dream up.

```
00:00–00:10  COLD OPEN                                   (no VO)
  Music + sizzle hits. Quick cuts:
   • [PROP] materializing on the AI puppet
   • beach scene snapping into place
   • cosmetics landing on the user puppet
   • puppet replying with the name [NAME] (audio peek)
  Optional: kid laughter laid over the materialization shot.

00:10–00:14  TITLE CARD                                  (no VO)
  Project name only. ~3s held. Save the tagline for the close.

00:14–00:18  HANDS-ONLY ESTABLISHING                     (no VO)
  Hand rises into frame, MediaPipe landmark overlay visible.
  Anchors the technical claim that the puppet is driven by live
  hand tracking. Cut to the puppet coming alive on stage.

00:18–00:35  SETUP + NAMING                              (12s VO, split)
  Kid: (raises a hand)
  AI puppet (in-app, ElevenLabs voice):
    "Hi friend! I'm a puppet — but I don't have a name yet.
     What should it be?"
  Kid: "Let's call you [NAME]!"
  AI puppet: "[NAME]! I love it. Hi, I'm [NAME]!"

  ── VO underneath the exchange ──
  VO: "A hand-puppet on the webcam, another on stage played by
       Claude. The stage puppet has no name — until the kid
       gives it one."
  (24 words / ~10s, ducked under the in-app dialogue)

00:35–00:55  CATALOG DRESSING                            (8s VO)
  Adult: "give [NAME] a crown."        → crown.
  Adult: "I want sunglasses."          → sunglasses on user puppet.
  VO (low, over the second request):
       "Claude can dress the puppets and place props from a
        small built-in catalog."
  (15 words / ~6s)

00:55–01:15  SCENE PLACEMENT                             (5s VO)
  Kid: "let's go to the beach!"
  Sun + sand castle + beach ball materialize at named
  anchors.
  VO (after the props land):
       "A few iconic props at named anchors. Minimalist
        scenery, maximalist imagination."
  (12 words / ~5s)

01:15–02:00  MONEY SHOT                                  (15s VO, split)
  Kid: "I want a [PROP]!"
  AI puppet (in-app): "Ooh, let me dream that up!"
  HUD dreaming chip pulses.

  ── VO Phase A, over the dreaming chip (~8s, light speed-ramp) ──
  VO: "While [NAME] stalls out loud, a separate Opus 4.7
       call is composing geometry from a handful of three.js
       primitives."
  (20 words / ~8s)

  Prop materializes, fade-in.

  ── VO Phase B, over the fade-in (~7s) ──
  VO: "The asset designer runs in parallel — it's always
       Opus, even when [NAME] is on Haiku."
  (15 words / ~6s)

  ── No VO over the kid's reaction. Let the moment breathe. ──

  OPTIONAL: chain a second prop ask if takes cooperate.
  Kid: "and a [SECOND_PROP]!" → second materialization.
  Reads as creative play, not a one-shot trick.

02:00–02:20  CACHE FLEX                                  (4s VO)
  Adult: "I want another [PROP]!" — instant pop-in.
  VO: "Asked again, it appears instantly from cache."
  (8 words / ~3s)

02:20–02:30  CLOSE + END CARD                            (5s VO)
  Final shot: both puppets (AI and user) wearing the [PROP],
  or a quiet beat on the assembled scene.
  VO: "An interface for play that didn't exist a year ago."
  (10 words / ~4s)
  End card: project name + GitHub URL + "Built with Opus 4.7"
```

**Totals.** ~104 words of VO across ~50 seconds of speech, distributed
over 2:30. Plenty of room for music, in-app audio, and silence.

## Notes on individual beats

### The naming beat — why it earns its 17 seconds

The kid offering a name and the puppet adopting it for the rest of
the session is the *clearest possible demonstration* that this isn't
scripted: the model is genuinely listening and adapting. Most
hackathon entries demo prepared flows; the unscripted name moment
breaks the "this is a tape" assumption a judge brings to the screen.
Worth the time even at 2:30.

### The generation-wait problem (money shot)

Asset generation takes 5–7 seconds end-to-end. A silent dead beat
that long would kill the cut. The fix: the wait is precisely when
the parallel-Opus architecture is doing its most interesting work,
so VO Phase A converts the wait into the technical reveal. Light
speed-ramp (1.5–2x) on the dreaming-chip footage if the actual gen
comes in fast. Don't pre-cache and lie — judges may try to verify.

The architecture VO (Phases A + B together) carries the *Most
Creative Opus 4.7* and *Depth & Execution* judging pitches. Worth
recording multiple takes and picking the best read.

### Kid recording session

Don't over-direct. Let him riff. If he asks for something other than
the spec's watermelon hat — banana hat, dragon, knight's helmet,
star wand, golden round glasses — and the asset generator lands a
coherent result, that's the real take. The demo gets stronger when
the prop is *his unscripted ask*, not a rehearsed line.

The expanded primitive set (capsule, star, frustum, pyramid, wedge,
heart, crescent, plus the existing seven) means many requests that
would have failed earlier — knight's helmet, sword, banana, beanie,
moon — should now land. Welcome multiple back-to-back asks.

Lines to capture from the kid (multiple takes):
- "Let's call you [NAME]!" (whatever name he picks — could be
  silly: "Pip", "Banana", "Captain Snail")
- "let's go to the beach!" (or any other location)
- "I want a [PROP]!" (whatever he picks; one or several in sequence)
- A natural reaction to props materializing
- Optional: a laugh for the cold-open audio bed

If he wants continuity (same AI puppet already wearing the catalog
cosmetics), set those up off-camera before he starts.

### Hands-only insert

3–5 seconds, early. Frame on hand and forearm entering view, with
the MediaPipe debug landmark overlay enabled. Cut back to the stage
and never show the webcam feed again. Privacy preserved, technical
claim landed. One shot does this work for the entire video.

### Voice quality

The in-app audio is now ElevenLabs flash (George by default), not
browser TTS. The puppet sounds genuinely warm and animated. The
naming beat's "Pip! I love it" line and the money-shot stall line
carry significant emotional weight that the old robotic voice
couldn't deliver. Lean into it — let the puppet's audio breathe in
the mix where it lands well.

## Open questions

1. **Title card text** — project name only (current pick), or pair
   it with a tagline? Saving the tagline for the close lands harder.
2. **Music** — track in mind, or pick one? Sincere-wonder register
   suggests light piano or sparse strings; royalty-free leads
   acceptable. Avoid "corporate inspirational."
3. **VO performance** — read it yourself with a decent mic
   (preferred), or TTS / ElevenLabs? Self-read sounds more human in
   a sincere-wonder register; TTS can read canned.
4. **Submission summary** — `docs/specs/submission-summary.md`
   currently anchors on "watermelon hat" and "sunglasses on my
   puppet." Update only after recording, when the actual `[NAME]`
   and `[PROP]` are known.
5. **Optional second-prop chain** — keep it as a fallback, or
   commit to it if takes are abundant? Two asks in a row sells
   "creative play" harder than one ask. Either is fine.

## What's locked and what's open

**Locked:**
- 2:30 length, sincere-wonder tone, VO + in-app audio.
- No webcam feed except hands-only insert.
- Kid drives setup+naming + scene + money shot; adult drives catalog
  + cache flex + close.
- Beat order and timings as listed above.
- VO copy for setup, catalog, scene, architecture, cache, close.
- Naming beat is in.

**Open until kid recording lands:**
- Specific `[NAME]` (used in setup-naming, catalog-dressing, and
  the architecture VO Phase A and B).
- Specific `[PROP]` (cold-open shot, materialization beat,
  cache-flex line, final shot). Optional `[SECOND_PROP]` for the
  back-to-back chain.
- Whether the cache flex re-asks for the same `[PROP]` or a different
  generated asset. Same-prop is the cleanest cache claim; second-ask
  on a different generated asset works too but reads as a "different
  cached thing" rather than "same thing now from cache."
