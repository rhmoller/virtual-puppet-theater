// src/landing.ts — Pre-flight landing screen. Owns camera/mic/TTS sanity
// checks before the theater spins up. Returns the live MediaStream so
// main.ts doesn't re-prompt for permission, and the user's optional
// voice override so it can suppress the server's pick.
//
// Why a landing page: the prior auto-init flow swallowed permission
// failures into a console.warn and left the user staring at an empty
// stage. This makes the failure modes addressable.

import { onVoicesReady } from "./speech";
import type { BrainSize } from "../server/protocol.ts";

export type LandingResult = {
  stream: MediaStream | null;
  userPickedVoiceURI: string | null;
  brainSize: BrainSize;
};

type RecCtor = new () => MinimalRec;
interface MinimalRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onresult:
    | ((ev: {
        resultIndex: number;
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

export function showLanding(): Promise<LandingResult> {
  return new Promise((resolve) => {
    const root = document.getElementById("landing") as HTMLDivElement | null;
    if (!root) {
      resolve({ stream: null, userPickedVoiceURI: null, brainSize: "large" });
      return;
    }
    const startBtn = document.getElementById("landing-start") as HTMLButtonElement;
    const camPreview = document.getElementById("landing-camera-preview") as HTMLVideoElement;
    const cameraStatus = document.getElementById("landing-camera-status") as HTMLDivElement;
    const sttStatus = document.getElementById("landing-stt-status") as HTMLDivElement;
    const sttText = document.getElementById("landing-stt-text") as HTMLTextAreaElement;
    const sttBtn = document.getElementById("landing-stt-btn") as HTMLButtonElement;
    const sttTrace = document.getElementById("landing-stt-trace") as HTMLDivElement;
    const ttsBtn = document.getElementById("landing-tts-btn") as HTMLButtonElement;
    const voiceSelect = document.getElementById("landing-voice-select") as HTMLSelectElement;
    const brainLargeBtn = document.getElementById("landing-brain-large") as HTMLButtonElement;
    const brainSmallBtn = document.getElementById("landing-brain-small") as HTMLButtonElement;

    let stream: MediaStream | null = null;
    let userPickedVoiceURI: string | null = null;
    let brainSize: BrainSize = "large";
    let landingRec: MinimalRec | null = null;
    let recRunning = false;

    // ---- Brain size toggle ----
    const setBrain = (next: BrainSize) => {
      brainSize = next;
      const isLarge = next === "large";
      brainLargeBtn.classList.toggle("active", isLarge);
      brainSmallBtn.classList.toggle("active", !isLarge);
      brainLargeBtn.setAttribute("aria-checked", String(isLarge));
      brainSmallBtn.setAttribute("aria-checked", String(!isLarge));
    };
    brainLargeBtn.addEventListener("click", () => setBrain("large"));
    brainSmallBtn.addEventListener("click", () => setBrain("small"));

    const setCameraStatus = (text: string, cls: "pending" | "ok" | "warn" | "err") => {
      cameraStatus.textContent = text;
      cameraStatus.className = `status ${cls}`;
    };
    const setSttStatus = (text: string, cls: "pending" | "ok" | "warn" | "err") => {
      sttStatus.textContent = text;
      sttStatus.className = `status ${cls}`;
    };

    // ---- Camera ----
    (async () => {
      setCameraStatus("Requesting camera…", "pending");
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no getUserMedia");
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        camPreview.srcObject = stream;
        // Fire-and-forget — a hung play() must not block the Start button.
        camPreview.play().catch(() => {});
        setCameraStatus("Camera ready", "ok");
      } catch (err) {
        console.warn("[landing] camera error:", err);
        setCameraStatus(
          "Camera blocked. Enable it in your browser, or continue without to watch the AI puppet.",
          "err",
        );
      } finally {
        startBtn.disabled = false;
      }
    })();

    // ---- Speech recognition ----
    const Ctor: RecCtor | undefined =
      (window as unknown as { SpeechRecognition?: RecCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecCtor }).webkitSpeechRecognition;
    if (!Ctor) {
      setSttStatus("Speech input needs Chrome or Edge — puppets still work without it.", "warn");
      sttText.placeholder = "Speech recognition unavailable in this browser.";
      sttText.disabled = true;
      sttBtn.disabled = true;
      sttBtn.textContent = "Microphone unavailable";
    } else {
      const sttLang = navigator.language || "en-US";
      setSttStatus(`Tap Test microphone, then speak (${sttLang}).`, "pending");
      const rec = new Ctor();
      // Use the browser's preferred locale instead of hardcoding en-US.
      // Phones in non-English locales (e.g. da-DK) get "nomatch" instead
      // of a transcript when forced to en-US, even for clear speech.
      rec.lang = sttLang;
      // Android Chrome silently drops onresult when continuous=true.
      // Keep single-utterance mode and let onend auto-restart between
      // turns; behavior on desktop is equivalent, just with more
      // start/end cycles. Same trade-off as src/brain.ts.
      rec.continuous = false;
      rec.interimResults = true;

      // Diagnostic trace — surfaces which lifecycle events the recognizer
      // actually fires. On Android Chrome, missing soundstart/speechstart
      // narrows down whether the mic isn't capturing, the audio isn't
      // recognized as speech, or the recognition pipeline silently failed.
      const trace: string[] = [];
      const logEvent = (ev: string) => {
        trace.push(ev);
        if (trace.length > 6) trace.shift();
        sttTrace.textContent = trace.join(" › ");
      };
      const extras = rec as unknown as {
        onaudiostart: (() => void) | null;
        onaudioend: (() => void) | null;
        onsoundstart: (() => void) | null;
        onsoundend: (() => void) | null;
        onspeechstart: (() => void) | null;
        onspeechend: (() => void) | null;
        onnomatch: (() => void) | null;
      };
      extras.onaudiostart = () => logEvent("audiostart");
      extras.onsoundstart = () => logEvent("soundstart");
      extras.onspeechstart = () => logEvent("speechstart");
      extras.onspeechend = () => logEvent("speechend");
      extras.onsoundend = () => logEvent("soundend");
      extras.onaudioend = () => logEvent("audioend");
      extras.onnomatch = () => logEvent("nomatch");
      // Append finalized chunks to a buffer; only re-render the tail of
      // unfinalized interim results each event. Avoids O(n²) string concat
      // as the preflight transcript grows.
      let finalText = "";
      rec.onstart = () => {
        recRunning = true;
        setSttStatus(`Listening in ${sttLang} — say something.`, "ok");
        logEvent("start");
      };
      rec.onresult = (ev) => {
        let interim = "";
        let gotFinal = false;
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (!r) continue;
          const alt = r[0];
          if (!alt?.transcript) continue;
          if (r.isFinal) {
            finalText += alt.transcript;
            gotFinal = true;
          } else interim += alt.transcript;
        }
        sttText.value = finalText + interim;
        sttText.scrollTop = sttText.scrollHeight;
        logEvent(gotFinal ? "result(final)" : "result(interim)");
      };
      rec.onerror = (ev) => {
        const e = ev.error;
        logEvent(`error:${e ?? "?"}`);
        if (e === "not-allowed" || e === "service-not-allowed") {
          setSttStatus("Microphone blocked. Enable mic in browser settings.", "err");
          recRunning = false;
        } else if (e === "no-speech") {
          setSttStatus("Didn't hear anything. Tap Test microphone again.", "warn");
        } else if (e === "audio-capture") {
          setSttStatus("Couldn't capture audio. Check the mic is free and try again.", "err");
        } else if (e === "network") {
          setSttStatus("Speech service offline — check your connection.", "err");
        } else if (e === "aborted") {
          // benign — onend will handle
        } else {
          setSttStatus(`Microphone error: ${e ?? "unknown"}`, "err");
        }
      };
      rec.onend = () => {
        logEvent("end");
        // Continuous mode ends each utterance on Android — auto-restart
        // only if the user actually had it running. Don't busy-loop after
        // a fatal error like denial.
        if (!recRunning) {
          setSttStatus("Microphone idle. Tap Test microphone to listen.", "pending");
          return;
        }
        try {
          rec.start();
        } catch {
          recRunning = false;
        }
      };
      sttBtn.addEventListener("click", () => {
        if (recRunning) return;
        try {
          rec.start();
          // recRunning is set in onstart so we don't lie if start fails async.
          setSttStatus("Starting microphone…", "pending");
        } catch (err) {
          setSttStatus(`Couldn't start microphone: ${(err as Error).message}`, "err");
        }
      });
      landingRec = rec;
    }

    // ---- TTS test + voice picker ----
    const populateVoices = () => {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const voices = synth.getVoices();
      const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
      // Preserve current selection if still present.
      const current = voiceSelect.value;
      voiceSelect.innerHTML = "";
      const auto = document.createElement("option");
      auto.value = "";
      auto.textContent = "Auto (AI picks)";
      voiceSelect.appendChild(auto);
      for (const v of en) {
        const opt = document.createElement("option");
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} (${v.lang})`;
        voiceSelect.appendChild(opt);
      }
      if (current && en.some((v) => v.voiceURI === current)) voiceSelect.value = current;
    };
    populateVoices();
    onVoicesReady(populateVoices);

    voiceSelect.addEventListener("change", () => {
      userPickedVoiceURI = voiceSelect.value || null;
    });

    if (!window.speechSynthesis) {
      ttsBtn.disabled = true;
      ttsBtn.textContent = "TTS unavailable";
    }
    ttsBtn.addEventListener("click", () => {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const u = new SpeechSynthesisUtterance(
        "Hello! This is your puppet voice. The show is about to begin.",
      );
      u.rate = 1.0;
      u.pitch = 0.95;
      const sel = voiceSelect.value;
      if (sel) {
        const v = synth.getVoices().find((vv) => vv.voiceURI === sel);
        if (v) u.voice = v;
      }
      synth.cancel();
      synth.speak(u);
    });

    // ---- Start ----
    // Brain.start() will create its own SpeechRecognition. Chrome only
    // allows one active recognizer per page, so we must wait for the
    // landing recognizer's onend (the real "I'm done" signal) before
    // resolving — otherwise Brain's start() races the landing's stop()
    // and silently fails with InvalidStateError.
    startBtn.addEventListener(
      "click",
      () => {
        root.classList.add("hidden");

        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          setTimeout(() => root.remove(), 400);
          resolve({ stream, userPickedVoiceURI, brainSize });
        };

        if (landingRec) {
          recRunning = false;
          const rec = landingRec;
          landingRec = null;
          // Replace handlers so the existing onend restart path doesn't fire.
          rec.onresult = null;
          rec.onerror = null;
          rec.onend = finish;
          try {
            rec.stop();
          } catch {
            // Wasn't actually running; resolve straight away.
            finish();
            return;
          }
          // Safety net — some browsers may not fire onend on an already-
          // stopped recognizer. Cap the wait so Start always proceeds.
          setTimeout(finish, 600);
        } else {
          finish();
        }
      },
      { once: true },
    );
  });
}
