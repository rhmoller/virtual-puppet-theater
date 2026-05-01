# Paper cut — variant 2 (maker-driven)

Draft plan for the 3-minute hackathon submission video. Variant 1 was
built around a kid-driven imagination half; the kid recording window
closed before bedtime on submission day, so this variant reframes the
demo around the maker showing their tool. The artifact is unchanged —
only the framing, voice, and beat ownership shift.

## Constraints and decisions

- **Length:** 2:55 target (the brief allows up to 3:00). 1:54 of
  recorded demo footage covers cold-open through money-shot plus a
  bonus dance-with-hats victory shot. The remaining ~1 minute is a
  thesis statement plus a "things we didn't cover" enumeration that
  surfaces the architecture (STT, TTS, premade vs Opus-generated
  props, the two-agent split). The earlier recolor and cache-flex
  beats are cut — neither was recorded, and the tech enumeration
  pulls the same architectural weight more honestly.
- **Framing:** "I built a co-creative interface for live play. Here's
  what it does." Quietly proud maker showing their thing. Not a kids'
  product pitch.
- **Tone:** earnest, low-key, a little wry. The wow beats land on
  technical reveals and on moments where the puppet *responds* in ways
  that feel alive — not on emotional kid reactions. Aligns with the
  *Most Creative Opus 4.7* rubric, which rewards projects "with a
  voice."
- **Audio:** speech only. Scripted voiceover (you) + in-app audio
  (the puppet's ElevenLabs flash voice + your live on-stage requests
  via STT). No music bed, no sound effects. Silence between speech
  is fine — and given the maker-driven register, deliberate silence
  reads as confident, not empty. Mix discipline matters more without
  a bed: VO close-mic'd and tight, on-stage voice mid-volume and
  loose, in-app puppet audio sits between them.
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
| 3  | Hands-only establishing    | 00:14–00:28   | live + VO    |
| 4  | Setup + naming             | 00:28–00:48   | live + VO    |
| 5  | Catalog dressing           | 00:48–01:05   | live + VO    |
| 6  | Scene placement            | 01:05–01:22   | live + VO    |
| 7  | Dance                      | 01:22–01:34   | live + VO    |
| 8  | Money shot                 | 01:34–02:17   | live + VO    |
| 9  | Thesis                     | 01:54–02:04   | VO over hold |
| 10 | Things we didn't cover     | 02:04–02:46   | VO + visuals |
| 11 | Close + end card           | 02:46–02:55   | live + VO    |

Beats 9–10 are voiceover-only "what's under the hood" content laid
over diagrams and harvested screen captures. The earlier recolor and
cache-flex beats were cut when the recording session ran clean enough
without them — the architecture-enumeration approach pulls the same
weight, more honestly, and uses the dance-with-hats victory shot as
the closing hold.

## Beat-by-beat with VO

VO speaking rate target: ~140 wpm (2.3 words/sec). The puppet's name
is **Bob**; the money-shot prop is the **ice cream hat**.

```
00:00–00:10  COLD OPEN                                   (silent visuals + audio peeks)
  No music, no SFX. Quick cuts of the most visually arresting
  moments:
   • ice cream hat materializing on Bob
   • beach scene snapping into place
   • cosmetics landing on the user puppet
   • Bob answering with his name (in-app audio peek — just the
     puppet's voice, no VO over it)
   • a recolor flash (e.g. shirt going from mustard → blue)
  Without a music bed the cuts must carry on visual rhythm alone.
  Tighter cuts (0.8–1.2s each) and one short audio peek of Bob
  saying his name anchor the scene — that single line tells the
  viewer this is a thing that talks back, before the title card
  lands.

00:10–00:14  TITLE CARD                                  (no VO)
  Project name only. ~3s held. Save the tagline for the close.

00:14–00:28  HANDS-ONLY ESTABLISHING                     (~14s, VO over)
  Single continuous take. The hand moves as if controlling a puppet
  throughout — same gestures, same motion arc, only the visual
  interpretation changes as you press D to cycle the four debug
  modes. The cumulative effect is "oh, that's the same hand, and
  here's what the system sees at each stage."

  ── Mode 1: camera (raw webcam, ~2.5s) ──
  Hand rises into frame, moving expressively.
  VO: "In the virtual puppet theater,"

  ── Mode 2: camera-markers (~4s) ──
  MediaPipe landmark overlay snaps onto the hand. Same motion
  continues underneath, now annotated with skeleton points.
  VO: "a webcam feed is analyzed by MediaPipe, which tracks
       hand landmarks and estimates their 3D positions."

  ── Mode 3: camera-puppet (~3.5s) ──
  Webcam still visible; rigged puppet now drives off the same
  motion, no theater behind it. The hand→puppet correspondence
  reads instantly because the gesture is unchanged.
  VO: "Those drive a rigged puppet —"

  ── Mode 4: normal (~4s, transitions into beat 4) ──
  Theater fades in around the puppet; AI puppet visible on stage.
  Webcam disappears. The user puppet is now in the world.
  VO: "who walks on stage to meet Claude's AI puppet."

  (34 words / ~14s at 140 wpm. Continuous hand motion across all
  four cuts is the load-bearing visual — do not cut to a separate
  take per mode.)

00:28–00:48  SETUP + NAMING                              (~10s VO, split)
  AI puppet (in-app):
    "Hi friend! I'm a puppet — but I don't have a name yet.
     What should it be?"
  Maker (on-stage voice): "Let's call you Bob."
  AI puppet: "Bob! I love it. Hi, I'm Bob!"

  ── VO underneath the exchange ──
  VO: "A hand-puppet on the webcam, another on stage played
       by Claude. The stage puppet has no name — until I
       give it one."
  (24 words / ~10s, ducked under the in-app dialogue)

00:48–01:05  CATALOG DRESSING                            (~6s VO)
  Maker: "Give Bob a crown."           → crown.
  Maker: "I want sunglasses."          → sunglasses on user puppet.
  VO (low, over the second request):
       "Claude can dress the puppets and place props from a
        small built-in catalog."
  (15 words / ~6s)

01:05–01:22  SCENE PLACEMENT                             (~5s VO)
  Maker: "Let's go to the beach."
  Sun + sand castle + beach ball materialize at named anchors.
  VO (after the props land):
       "Iconic props at named anchors. Minimalist scenery,
        maximalist imagination."
  (11 words / ~5s)

01:22–01:34  DANCE                                       (~7s VO)
  Maker: "Bob, let's dance!"
  Bob plays a dance animation/audio. Maker's hand moves
  expressively on the webcam — user puppet sways with it,
  Bob mirrors and embellishes.
  VO (over the dance):
       "Body language from the webcam flows live to the
        model. Bob picks up the cue and dances back."
  (17 words / ~7s)

01:34–02:17  MONEY SHOT                                  (~14s VO, split)
  Maker: "I want an ice cream hat."
  AI puppet: "Ooh, let me dream that up!"
  HUD dreaming chip pulses.

  ── VO Phase A, over the dreaming chip (~7s, light speed-ramp) ──
  VO: "While Bob stalls out loud, a separate Opus 4.7 call
       is composing geometry from a handful of three.js
       primitives."
  (19 words / ~7s)

  Prop materializes, fade-in.

  ── VO Phase B, over the fade-in (~6s) ──
  VO: "The asset designer runs in parallel — it's always
       Opus, even when Bob is on Haiku."
  (14 words / ~6s)

  ── No VO over the puppet's reaction. Let the moment breathe. ──

  OPTIONAL: chain a second prop ask if the first take is clean.
  Maker: "And a [SECOND_PROP]." → second materialization.
  Reads as confidence in the system, not a one-shot trick.

01:54–02:04  THESIS                                      (~11s VO)
  Visual: dance-with-hats footage holds, slightly slowed.
  VO: "This was an exploration of using Opus 4.7 for playful,
       creative interaction — a small world a kid or playful
       adult can shape by talking to it."
  (26 words / ~11s)

02:04–02:46  THINGS WE DIDN'T COVER                       (~42s VO, 4 sub-items)
  Dissolve to a darker panel. Each sub-item gets its own visual;
  VO reads as one continuous list.

  ── Bridge (~3s) ──
  VO: "A few things we didn't get to show:"
  (8 words)

  ── Sub-item 1: STT (~9s) ──
  Visual: STT HUD frame from the app showing the live transcript
  chip ("STT listening" → spoken phrase appears).
  VO: "Speech-in is the browser's Web Speech API — free, decent,
       works in any modern Chrome."
  (16 words)

  ── Sub-item 2: TTS (~9s) ──
  Visual: a still of Bob mid-line with an "ElevenLabs Flash" tag
  overlaid; brief audio peek of his voice underneath.
  VO: "Bob's voice is ElevenLabs Flash — more life and expression
       than the browser's built-in synthesis."
  (16 words)

  ── Sub-item 3: generated props (~10s) ──
  Visual: the ice cream hat still (puppets-with-hats.png) holds.
  Asset-spec JSON inset on one side, an "Opus 4.7" tag on the
  other. Catalog half is dropped — the contrast lives in the VO,
  not the frame.
  VO: "Some props are pre-built three.js. Others — like the
       ice cream hat — Opus composes from primitives on the
       fly, the first time you ask."
  (28 words)

  ── Sub-item 4: two agents (~11s) ──
  Visual: simple diagram. Two boxes — "Bob — Haiku 4.5" and
  "Prop builder — Opus 4.7" — sharing a cache band underneath.
  VO: "And there are two agents under the hood, one shared
       cache: Bob's brain runs on Haiku for fast turn-taking,
       the prop builder runs on Opus when geometry has to be
       invented."
  (32 words)

02:46–02:55  CLOSE + END CARD                             (~4s VO)
  Visual: dance-with-hats footage returns. Tagline lands over it;
  end card overlays at the tail.
  VO: "An interface for play that didn't exist a year ago."
  (10 words / ~4s)
  End card: project name + GitHub URL + "Built with Opus 4.7".
```

**Totals.** ~190 words of VO across ~80 seconds of speech, distributed
over 2:55. Silence and in-app audio fill the rest. The 1:54 of
recorded footage carries the demo; the back ~1 minute is a thesis
plus a four-item architecture enumeration over diagrams and harvested
screen captures.

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

All on-stage lines are already captured in the 1:54 of recorded
footage:

- "Let's call you Bob."
- "Give Bob a crown."
- "I want sunglasses."
- "Let's go to the beach."
- "Bob, let's dance!"
- "I want an ice cream hat."

Still to record: the back-half VO (thesis + four "didn't cover"
items + tagline). All voice-only, no live-action takes left.

Record VO separately after the visual takes lock — VO over picture
edits cleanly, the reverse is painful.

### Hands-only insert (pipeline reveal)

14 seconds, early. Single continuous hand take with the four debug
modes (D key cycles `normal → camera → camera-markers →
camera-puppet → normal`) cut underneath. The hand performs natural
puppet-controlling motion throughout — small waves, pinches, a
gentle bow — and the *only* thing that changes per cut is what the
system overlays on or extracts from that motion. That's the visual
proof that everything downstream is grounded in real input, not
canned animation.

Privacy preserved (no face), technical claim landed comprehensively.
This one beat replaces what would otherwise need a 30-second
"how it works" explainer later.

Recording note: cycle the modes manually with D between takes, or
do one long take in each mode and rely on the editor to align them
to the same hand motion. The latter is safer — easier to land a
crisp 3.5s rhythm in post than to nail mode-cycle timing live.

### Voice quality

The in-app audio is ElevenLabs flash (George by default) — warm,
animated, takes direction. The naming beat's "Bob! I love it"
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
2. **VO performance** — your own voice (preferred for authenticity in
   the maker-driven framing), or ElevenLabs flash? Self-read fits the
   "quietly proud maker" register better than any TTS will.
3. **Submission summary** — `docs/specs/submission-summary.md` may
   anchor on the older kid-driven copy. Update after recording locks
   so it references Bob and the ice cream hat by name.
4. **Optional second prop chain** — keep as fallback, or commit if
   takes are clean? Two asks in a row sells "creative play" harder.
   With no kid scheduling pressure, the cost of trying both is low.

## What's locked and what's open

**Locked:**

- 2:55 length, single-narrator (maker) VO, in-app audio.
- Speech-only audio. No music, no sound effects.
- No webcam feed except hands-only insert.
- Maker drives every beat. No kid recording.
- Beat order and timings as listed above.
- Naming beat is in.
- Puppet name: **Bob**.
- Money-shot prop: **ice cream hat**.
- Dance beat after scene placement (demonstrates the body-language
  signal path from webcam to model).
- 1:54 of demo footage already recorded, covering cold-open through
  money-shot plus a dance-with-hats victory shot (now the closer).
- Recolor and cache-flex beats removed — replaced by a "things we
  didn't cover" architecture enumeration in the back ~1 minute.

**Open until VO and visuals land:**

- Visual treatment for beat 10: animated boxes vs. harvested screen
  captures (action JSON, asset spec) vs. a hybrid. Recommend hybrid:
  one diagram building behind, plus short concrete inserts (STT HUD
  frame, asset-spec JSON inset) when the VO names something specific.
- Whether to record the bridge line ("A few things we didn't get to
  show:") with a small "audible breath" pause before the list, or
  cold-cut into sub-item 1.
