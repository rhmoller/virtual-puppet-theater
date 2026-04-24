// src/speech.ts — Clawd's TTS. Picks an English-leaning male-ish voice,
// queues utterances that arrive before (a) the autoplay-policy unlock
// and (b) the async voice list has populated, and flushes the queue
// on the first user gesture once both are ready.

function pickClawdVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const MALE = /daniel|alex|fred|rishi|oliver|george|aaron|arthur|male|david|mark|james|\+m[1-7]\b/i;
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
  for (const text of queued) speakNow(text);
}

function speakNow(text: string, retry = true) {
  const synth = window.speechSynthesis;
  if (!synth || !text) {
    console.warn("[tts] skip", { hasSynth: !!synth, text });
    return;
  }
  const preState = { speaking: synth.speaking, pending: synth.pending, paused: synth.paused };
  if (synth.speaking || synth.pending) synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.0;
  utter.pitch = 0.9;
  const voice = pickClawdVoice();
  if (voice) utter.voice = voice;
  const voiceInfo = voice
    ? { name: voice.name, lang: voice.lang, localService: voice.localService, default: voice.default }
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
  });
  utter.onstart = () => console.log("[tts] onstart", { text });
  utter.onend = () => console.log("[tts] onend", { text });
  utter.onerror = (e) => {
    const err = (e as SpeechSynthesisErrorEvent).error;
    console.warn("[tts] error:", err, { text, retry });
    if (retry && err === "synthesis-failed") {
      setTimeout(() => speakNow(text, false), 120);
    }
  };
  synth.speak(utter);
}

export function speak(text: string) {
  if (!speechUnlocked || !voicesReady) {
    console.log("[tts] queued:", text, { speechUnlocked, voicesReady });
    pendingSpeech.push(text);
    return;
  }
  speakNow(text);
}

export function cancelSpeech() {
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
    utter.onerror = (e) => console.warn("[tts-test] error:", (e as SpeechSynthesisErrorEvent).error);
    synth.speak(utter);
    console.log("[tts-test] speak() called");
  });
}
