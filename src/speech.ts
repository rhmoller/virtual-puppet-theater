// src/speech.ts — Stage-puppet TTS. Primary path streams MP3 from the
// server's /tts endpoint (ElevenLabs); browser speechSynthesis is the
// fallback if /tts errors. Queues utterances that arrive before the
// autoplay-policy unlock, then flushes on the first user gesture.
// Serializes sequential replies so a new utterance waits for the current
// one to finish instead of cutting it off mid-sentence.

// voiceURI chosen by the server via Claude. Null until the server picks
// (or if the pick failed / returned no suitable voice). When null we fall
// back to the regex heuristic.
let selectedVoiceURI: string | null = null;

export function setSelectedVoice(voiceURI: string) {
  selectedVoiceURI = voiceURI;
  console.log("[tts] voice selected by brain:", voiceURI);
}

function pickStageVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (selectedVoiceURI) {
    const chosen = voices.find((v) => v.voiceURI === selectedVoiceURI);
    if (chosen) return chosen;
  }
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

// Collect the browser's voice list in the serializable shape the server
// needs. Returns null if voices aren't yet available.
export function snapshotVoices():
  | {
      voiceURI: string;
      name: string;
      lang: string;
      localService: boolean;
      default: boolean;
    }[]
  | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (voices.length === 0) return null;
  return voices.map((v) => ({
    voiceURI: v.voiceURI,
    name: v.name,
    lang: v.lang,
    localService: v.localService,
    default: v.default,
  }));
}

// Fire `cb` once, as soon as the browser voice list is populated.
export function onVoicesReady(cb: () => void) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  if (synth.getVoices().length > 0) {
    cb();
    return;
  }
  const handler = () => {
    if (synth.getVoices().length === 0) return;
    synth.removeEventListener?.("voiceschanged", handler);
    cb();
  };
  synth.addEventListener?.("voiceschanged", handler);
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

// ElevenLabs path state. `currentAudio` is the in-flight HTMLAudioElement
// so cancelSpeech() can stop it. `elevenAvailable` flips false after the
// first /tts failure to avoid hammering a broken endpoint for the rest
// of the session — subsequent utterances go straight to the browser path.
let currentAudio: HTMLAudioElement | null = null;
let elevenAvailable = true;

// Speaking-burst callback: fires once when the puppet starts talking and
// once when the burst drains (queue empty, nothing in flight). Used by
// the puppet's lip-sync animation so it covers the whole burst, not just
// one utterance.
type SpeakingCallback = (speaking: boolean) => void;
let speakingCallback: SpeakingCallback | null = null;
let burstSpeaking = false;

export function setSpeakingCallback(cb: SpeakingCallback) {
  speakingCallback = cb;
}

function startBurst() {
  if (burstSpeaking) return;
  burstSpeaking = true;
  speakingCallback?.(true);
}

function endBurst() {
  if (!burstSpeaking) return;
  burstSpeaking = false;
  speakingCallback?.(false);
}

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
  playing = true;
  speakNow(text);
}

function speakNow(text: string) {
  if (elevenAvailable) {
    void speakNowEleven(text);
  } else {
    speakNowBrowser(text);
  }
}

async function speakNowEleven(text: string) {
  let url: string | null = null;
  try {
    const res = await fetch("/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`tts http ${res.status}`);
    const blob = await res.blob();
    url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    console.log("[tts] eleven speak", { text, length: text.length });
    const cleanup = () => {
      if (url) URL.revokeObjectURL(url);
      url = null;
      currentAudio = null;
    };
    audio.onplay = () => {
      console.log("[tts] eleven onplay", { text });
      startBurst();
    };
    audio.onended = () => {
      console.log("[tts] eleven onended", { text });
      cleanup();
      playing = false;
      if (utteranceQueue.length === 0) endBurst();
      playNextUtterance();
    };
    audio.onerror = () => {
      console.warn("[tts] eleven audio error", { text });
      cleanup();
      playing = false;
      if (utteranceQueue.length === 0) endBurst();
      playNextUtterance();
    };
    await audio.play();
  } catch (err) {
    console.warn("[tts] eleven failed, falling back to browser TTS:", err);
    if (url) URL.revokeObjectURL(url);
    currentAudio = null;
    elevenAvailable = false;
    speakNowBrowser(text);
  }
}

function speakNowBrowser(text: string, retry = true) {
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
  const voice = pickStageVoice();
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
  utter.onstart = () => {
    console.log("[tts] onstart", { text });
    startBurst();
  };
  utter.onend = () => {
    console.log("[tts] onend", { text });
    playing = false;
    if (utteranceQueue.length === 0) endBurst();
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
    if (utteranceQueue.length === 0) endBurst();
    playNextUtterance();
  };
  synth.speak(utter);
}

export function speak(text: string) {
  // ElevenLabs path doesn't need browser voices; only the autoplay
  // gesture-unlock gate matters. Browser fallback's existing retry
  // handles the case where voices haven't loaded yet on its own.
  if (!speechUnlocked) {
    console.log("[tts] queued:", text, { speechUnlocked });
    pendingSpeech.push(text);
    return;
  }
  enqueueUtterance(text);
}

export function cancelSpeech() {
  utteranceQueue.length = 0;
  playing = false;
  endBurst();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  window.speechSynthesis?.cancel();
}

export function installSpeechUnlock() {
  const unlock = () => {
    if (speechUnlocked) return;
    speechUnlocked = true;
    setTimeout(() => {
      flushPendingSpeech();
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
