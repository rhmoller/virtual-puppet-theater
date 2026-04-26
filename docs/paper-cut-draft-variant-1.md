# Paper cut — variant 2 (maker-driven)

Draft plan for the 3-minute hackathon submission video. Variant 1 was
built around a kid-driven imagination half; the kid recording window
closed before bedtime on submission day, so this variant reframes the
demo around the maker showing their tool. The artifact is unchanged —
only the framing, voice, and beat ownership shift.

## Constraints and decisions

- **Length:** 2:30 hard target (the brief allows up to 3:00, but a
  tight 2:30 likely scores better).
- **Framing:** "I built a co-creative interface for live play. Here's
  what it does." Quietly proud maker showing their thing. Not a kids'
  product pitch.
- **Tone:** earnest, low-key, a little wry. The wow beats land on
  technical reveals and on moments where the puppet *responds* in ways
  that feel alive — not on emotional kid reactions. Aligns with the
  *Most Creative Opus 4.7* rubric, which rewards projects "with a
  voice."
- **Audio:** scripted voiceover (you) + in-app audio (the puppet's
  ElevenLabs flash voice + your live STT) ducked underneath. Music
  bed sparse, deliberate silences allowed.
- **On camera:** no webcam feed except one short hands-only insert
  that establishes MediaPipe input. No faces shown.
- **Voices on stage:** single narrator (you) throughout. Mic-on-stand
  works fine; the same voice does both the on-stage "user-puppet
  speaker" role (asking the puppet for things) and the over-the-top
  VO. We separate the two by mix: on-stage voice is mid-volume and
  loose; VO is closer-mic'd, tighter, slightly compressed.
- **Money-shot prop:** maker's pre-decided choice for the takeable
  shot, but recorded live (no pre-cache) so the asset gen actually
  runs. Pick something the expanded primitive set handles well — a
  banana hat, knight's helmet, or watermelon hat are all known-good.
  Optional: chain a second prop ask if the first lands clean.
- **Puppet name:** the AI puppet is nameless by default; you name it
  on camera in the setup beat. The LLM adopts the name from then on.
  Pick something short, distinct, and not a common English word so
  the "it remembered the name" beat reads as listening, not pattern
  matching. Suggestions: "Pip", "Mox", "Bramble", "Tova".
- **Recording order:** all in one session. Adult-only means there's no
  scheduling constraint — record clean takes of each beat, pick the
  best, edit. VO can be recorded after the visual takes lock.

## Structural shape

| #  | Beat                       | Time          | Source       |
|----|----------------------------|---------------|--------------|
| 1  | Cold open / sizzle         | 00:00–00:10   | edited cuts  |
| 2  | Title card                 | 00:10–00:14   | —            |
| 3  | Hands-only establishing    | 00:14–00:18   | —            |
| 4  | Setup + naming             | 00:18–00:38   | live + VO    |
| 5  | Catalog dressing           | 00:38–00:55   | live + VO    |
| 6  | Scene placement            | 00:55–01:12   | live + VO    |
| 7  | Money shot                 | 01:12–01:55   | live + VO    |
| 8  | Recolor flourish           | 01:55–02:10   | live + VO    |
| 9  | Cache flex                 | 02:10–02:25   | live + VO    |
| 10 | Close + end card           | 02:25–02:30   | —            |

A new beat 8 (recolor) replaces what was previously a longer kid-driven
money-shot tail. It's a 15-second beat that shows off the voice-driven
recolor op (just landed today), and it's a satisfying visual change
that's cheap to record cleanly without a kid.

## Beat-by-beat with VO

VO speaking rate target: ~140 wpm (2.3 words/sec). `[NAME]` = the
in-session name you pick. `[PROP]` = your chosen money-shot prop.

```
00:00–00:10  COLD OPEN                                   (no VO)
  Music + sizzle. Quick cuts:
   • [PROP] materializing on the AI puppet
   • beach scene snapping into place
   • cosmetics landing on the user puppet
   • puppet answering with the name [NAME] (audio peek)
   • a recolor flash (e.g. shirt going from mustard → blue)
  Optional: a quiet exhale or single "huh" reaction laid over the
  materialization shot. No kid-laughter audio (we don't have it).

00:10–00:14  TITLE CARD                                  (no VO)
  Project name only. ~3s held. Save the tagline for the close.

00:14–00:18  HANDS-ONLY ESTABLISHING                     (no VO)
  Hand rises into frame, MediaPipe landmark overlay visible.
  Anchors the technical claim. Cut to the puppet coming alive
  on stage.

00:18–00:38  SETUP + NAMING                              (~10s VO, split)
  AI puppet (in-app):
    "Hi friend! I'm a puppet — but I don't have a name yet.
     What should it be?"
  Maker (on-stage voice): "Let's call you [NAME]."
  AI puppet: "[NAME]! I love it. Hi, I'm [NAME]!"

  ── VO underneath the exchange ──
  VO: "A hand-puppet on the webcam, another on stage played
       by Claude. The stage puppet has no name — until I
       give it one."
  (24 words / ~10s, ducked under the in-app dialogue)

00:38–00:55  CATALOG DRESSING                            (~6s VO)
  Maker: "Give [NAME] a crown."        → crown.
  Maker: "I want sunglasses."          → sunglasses on user puppet.
  VO (low, over the second request):
       "Claude can dress the puppets and place props from a
        small built-in catalog."
  (15 words / ~6s)

00:55–01:12  SCENE PLACEMENT                             (~5s VO)
  Maker: "Let's go to the beach."
  Sun + sand castle + beach ball materialize at named anchors.
  VO (after the props land):
       "Iconic props at named anchors. Minimalist scenery,
        maximalist imagination."
  (11 words / ~5s)

01:12–01:55  MONEY SHOT                                  (~14s VO, split)
  Maker: "I want a [PROP]."
  AI puppet: "Ooh, let me dream that up!"
  HUD dreaming chip pulses.

  ── VO Phase A, over the dreaming chip (~7s, light speed-ramp) ──
  VO: "While [NAME] stalls out loud, a separate Opus 4.7
       call is composing geometry from a handful of three.js
       primitives."
  (19 words / ~7s)

  Prop materializes, fade-in.

  ── VO Phase B, over the fade-in (~6s) ──
  VO: "The asset designer runs in parallel — it's always
       Opus, even when [NAME] is on Haiku."
  (15 words / ~6s)

  ── No VO over the puppet's reaction. Let the moment breathe. ──

  OPTIONAL: chain a second prop ask if the first take is clean.
  Maker: "And a [SECOND_PROP]." → second materialization.
  Reads as confidence in the system, not a one-shot trick.

01:55–02:10  RECOLOR FLOURISH                            (~5s VO)
  Maker: "Make your shirt blue. And give yourself green hair."
  Both recolors land in one turn (the LLM fans the request into
  two recolor effects).
  VO (over the change):
       "Voice-controlled recolor. The puppet's whole palette
        is one Opus call away."
  (14 words / ~6s)

02:10–02:25  CACHE FLEX                                  (~5s VO)
  Maker: "I want another [PROP]." — instant pop-in.
  VO: "Asked again, it appears instantly from cache."
  (8 words / ~3s)

02:25–02:30  CLOSE + END CARD                            (~4s VO)
  Final shot: both puppets (AI and user) wearing the [PROP],
  recolored palette, full beach scene assembled — a single
  packed frame summarizing what was made.
  VO: "An interface for play that didn't exist a year ago."
  (10 words / ~4s)
  End card: project name + GitHub URL + "Built with Opus 4.7".
```

**Totals.** ~106 words of VO across ~50 seconds of speech, distributed
over 2:30. Silence and in-app audio fill the rest.

## Notes on individual beats

### The naming beat — why it still earns its 20 seconds

The puppet adopting the name and using it later is the clearest
demonstration that this isn't a tape. With kid-driven framing it
landed as emotional charm; with maker-driven framing it lands as
"the model is genuinely listening." Same beat, different pitch.
The follow-through (the puppet using `[NAME]` again later in the
architecture VO Phase A) is now load-bearing for that read — make
sure the take where you record the architecture VO uses the same
`[NAME]` you used in setup.

### The recolor beat (new)

Replaces the previous "second kid prop ask" with a non-kid beat that
*feels* like creative play. Two recolors in one utterance shows the
LLM fanning out into multiple effects, and the visual change is
immediate and satisfying. Picks: `shirt → blue` + `hair → green/pink`
reads cleanly on lavender skin. Avoid `skin → red` — it looks alarming.

### The generation-wait problem (money shot)

Asset generation takes ~5–7 seconds end-to-end with prompt caching
(now actually working post-today's fix). A silent dead beat that long
would kill the cut. The fix: the wait is precisely when the parallel
Opus architecture is doing its most interesting work, so VO Phase A
converts the wait into the technical reveal. Light speed-ramp
(1.5–2x) on the dreaming-chip footage if the actual gen comes in fast.

Don't pre-cache and lie. Record live; if a take feels too slow, edit
the chip-pulse footage rather than fake the gen latency.

### Recording session (single person)

Lines to record cleanly (multiple takes each, pick the best):
- "Let's call you [NAME]." (commit to one name across all takes)
- "Give [NAME] a crown."
- "I want sunglasses."
- "Let's go to the beach."
- "I want a [PROP]." (the money-shot ask)
- Optional: "And a [SECOND_PROP]."
- "Make your shirt blue. And give yourself green hair."
- "I want another [PROP]." (the cache flex)

Record VO separately after the visual takes lock — VO over picture
edits cleanly, the reverse is painful.

### Hands-only insert

3–5 seconds, early. Frame on hand and forearm entering view, with
the MediaPipe debug landmark overlay enabled. Cut back to the stage
and never show the webcam feed again. Privacy preserved, technical
claim landed. One shot does this work for the entire video.

### Voice quality

The in-app audio is ElevenLabs flash (George by default) — warm,
animated, takes direction. The naming beat's "[NAME]! I love it"
line and the money-shot stall line carry significant weight that the
old browser TTS couldn't deliver. Lean in: let the puppet's audio
breathe in the mix where it lands well.

For your own VO: a closer mic + light compression. Sincere-wonder
register reads as fake when over-performed; an inside-voice delivery
will land better than a polished announcer read. If self-mic'd VO
sounds bad after a couple of takes, ElevenLabs flash can do the VO
pass too — pick a voice that's distinct from the in-app puppet voice
so the listener never confuses them.

## Open questions

1. **Title card text** — project name only (current pick), or pair it
   with a tagline? Saving the tagline for the close still lands harder.
2. **Music** — sparse piano or quiet strings; royalty-free leads
   acceptable. Avoid "corporate inspirational." Maker-driven framing
   tolerates more sparse + deliberate than kid-driven would have.
3. **VO performance** — your own voice (preferred for authenticity in
   the maker-driven framing), or ElevenLabs flash? Self-read fits the
   "quietly proud maker" register better than any TTS will.
4. **Submission summary** — `docs/specs/submission-summary.md` may
   anchor on the older kid-driven copy. Update after recording locks
   and the actual `[NAME]` and `[PROP]` are known.
5. **Optional second prop chain** — keep as fallback, or commit if
   takes are clean? Two asks in a row sells "creative play" harder.
   With no kid scheduling pressure, the cost of trying both is low.

## What's locked and what's open

**Locked:**
- 2:30 length, single-narrator (maker) VO, in-app audio.
- No webcam feed except hands-only insert.
- Maker drives every beat. No kid recording.
- Beat order and timings as listed above.
- Recolor flourish beat included.
- Naming beat is in.

**Open until recording lands:**
- Specific `[NAME]` (used in setup-naming, catalog-dressing, and the
  architecture VO Phase A and B). Pick before recording starts and
  use it consistently across all takes.
- Specific `[PROP]` (cold-open shot, materialization beat, cache-flex
  line, final shot). Optional `[SECOND_PROP]` for the back-to-back
  chain.
- Whether the cache flex re-asks for the same `[PROP]` or a different
  generated asset. Same-prop is the cleanest cache claim.
