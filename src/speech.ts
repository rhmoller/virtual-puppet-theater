// src/speech.ts — Clawd's TTS. Picks an English-leaning male-ish voice,
// queues utterances that arrive before (a) the autoplay-policy unlock
// and (b) the async voice list has populated, and flushes the queue
// on the first user gesture once both are ready. Also serializes
// sequential replies so a new utterance waits for the current one to
// finish instead of cutting it off mid-sentence.

function pickClawdVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const MALE =
    /daniel|alex|fred|rishi|oliver|george|aaron|arthur|male|david|mark|james|\+m[1-7]\b/i;
  return (
    en.find((v) => /google/i.test(v.name) && MALE.test(v.name)) ||
    en.find((v) => MALE.test(v.name)) ||
    en.find((v) => /google/i.test(v.name)) ||
    en[0] ||
    null
  );
}

// Chrome blocks speechSynthesis.speak() until the page has had a user
// gesture. Queue speech until then and flush on the first click/keypress.
// Chrome also loads the voice list asynchronously — speaking before the
// list is populated yields "synthesis-failed", so gate on that too.
let speechUnlocked = false;
let voicesReady = (window.speechSynthesis?.getVoices().length ?? 0) > 0;
const pendingSpeech: string[] = [];

// FIFO queue of utterances waiting for the current one to finish.
// `playing` is the single source of truth — synth.speaking can lag a
// short moment after synth.speak() and we don't want to race it.
const utteranceQueue: string[] = [];
let playing = false;

if (window.speechSynthesis && !voicesReady) {
  // Touching getVoices() kicks Chrome into loading them.
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    voicesReady = (window.speechSynthesis.getVoices().length ?? 0) > 0;
    if (voicesReady && speechUnlocked) flushPendingSpeech();
  });
}

function flushPendingSpeech() {
  const queued = pendingSpeech.splice(0);
  for (const text of queued) enqueueUtterance(text);
}

function enqueueUtterance(text: string) {
  utteranceQueue.push(text);
  playNextUtterance();
}

function playNextUtterance() {
  if (playing) return;
  const text = utteranceQueue.shift();
  if (!text) return;
  speakNow(text);
}

function speakNow(text: string, retry = true) {
  const synth = window.speechSynthesis;
  if (!synth || !text) {
    console.warn("[tts] skip", { hasSynth: !!synth, text });
    return;
  }
  playing = true;
  const preState = { speaking: synth.speaking, pending: synth.pending, paused: synth.paused };
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.0;
  utter.pitch = 0.9;
  const voice = pickClawdVoice();
  if (voice) utter.voice = voice;
  const voiceInfo = voice
    ? {
        name: voice.name,
        lang: voice.lang,
        localService: voice.localService,
        default: voice.default,
      }
    : null;
  console.log("[tts] speak", {
    text,
    length: text.length,
    retry,
    rate: utter.rate,
    pitch: utter.pitch,
    voice: voiceInfo,
    voiceCount: synth.getVoices().length,
    preState,
    queued: utteranceQueue.length,
  });
  utter.onstart = () => console.log("[tts] onstart", { text });
  utter.onend = () => {
    console.log("[tts] onend", { text });
    playing = false;
    playNextUtterance();
  };
  utter.onerror = (e) => {
    const err = (e as SpeechSynthesisErrorEvent).error;
    console.warn("[tts] error:", err, { text, retry });
    playing = false;
    if (retry && err === "synthesis-failed") {
      // Re-queue at the head so it plays as soon as nothing else is in
      // flight. One retry only; `interrupted` is a deliberate cancel and
      // must not re-queue, or cancelSpeech() becomes useless.
      utteranceQueue.unshift(text);
      setTimeout(() => {
        if (!playing) playNextUtterance();
      }, 120);
      return;
    }
    playNextUtterance();
  };
  synth.speak(utter);
}

export function speak(text: string) {
  if (!speechUnlocked || !voicesReady) {
    console.log("[tts] queued:", text, { speechUnlocked, voicesReady });
    pendingSpeech.push(text);
    return;
  }
  enqueueUtterance(text);
}

export function cancelSpeech() {
  utteranceQueue.length = 0;
  playing = false;
  window.speechSynthesis?.cancel();
}

export function installSpeechUnlock() {
  const unlock = () => {
    if (speechUnlocked) return;
    speechUnlocked = true;
    setTimeout(() => {
      if (voicesReady) flushPendingSpeech();
    }, 50);
  };
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
  window.addEventListener("touchstart", unlock, { capture: true });

  // Press "h" for a minimal TTS smoke test — bypasses the queue/gating.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "h" && e.key !== "H") return;
    const synth = window.speechSynthesis;
    const voices = synth?.getVoices() ?? [];
    console.log("[tts-test] H pressed", {
      hasSynth: !!synth,
      voiceCount: voices.length,
      voices: voices.map((v) => `${v.name} (${v.lang})`),
      speaking: synth?.speaking,
      pending: synth?.pending,
      paused: synth?.paused,
    });
    if (!synth) return;
    const utter = new SpeechSynthesisUtterance("Hello");
    utter.onstart = () => console.log("[tts-test] onstart");
    utter.onend = () => console.log("[tts-test] onend");
    utter.onerror = (err) =>
      console.warn("[tts-test] error:", (err as SpeechSynthesisErrorEvent).error);
    synth.speak(utter);
    console.log("[tts-test] speak() called");
  });
}
