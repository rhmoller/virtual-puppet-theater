// src/landing.ts — Pre-flight landing screen. Owns camera/mic/TTS sanity
// checks before the theater spins up. Returns the live MediaStream so
// main.ts doesn't re-prompt for permission, and the user's optional
// voice override so it can suppress the server's pick.
//
// Why a landing page: the prior auto-init flow swallowed permission
// failures into a console.warn and left the user staring at an empty
// stage. This makes the failure modes addressable.

import { onVoicesReady } from "./speech";

export type LandingResult = {
  stream: MediaStream | null;
  userPickedVoiceURI: string | null;
};

type RecCtor = new () => MinimalRec;
interface MinimalRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

export function showLanding(): Promise<LandingResult> {
  return new Promise((resolve) => {
    const root = document.getElementById("landing") as HTMLDivElement | null;
    if (!root) {
      resolve({ stream: null, userPickedVoiceURI: null });
      return;
    }
    const startBtn = document.getElementById("landing-start") as HTMLButtonElement;
    const camPreview = document.getElementById("landing-camera-preview") as HTMLVideoElement;
    const cameraStatus = document.getElementById("landing-camera-status") as HTMLDivElement;
    const sttStatus = document.getElementById("landing-stt-status") as HTMLDivElement;
    const sttText = document.getElementById("landing-stt-text") as HTMLTextAreaElement;
    const ttsBtn = document.getElementById("landing-tts-btn") as HTMLButtonElement;
    const voiceSelect = document.getElementById("landing-voice-select") as HTMLSelectElement;

    let stream: MediaStream | null = null;
    let userPickedVoiceURI: string | null = null;
    let landingRec: MinimalRec | null = null;
    let recRunning = false;

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
        await camPreview.play().catch(() => {});
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
    } else {
      setSttStatus("Speak — your words will appear below.", "ok");
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (ev) => {
        let composed = "";
        for (let i = 0; i < ev.results.length; i++) {
          const r = ev.results[i];
          const alt = r?.[0];
          if (alt?.transcript) composed += alt.transcript;
        }
        sttText.value = composed;
        sttText.scrollTop = sttText.scrollHeight;
      };
      rec.onerror = (ev) => {
        const e = ev.error;
        if (e === "not-allowed" || e === "service-not-allowed") {
          setSttStatus("Microphone blocked. Enable mic in browser settings to talk to the AI.", "err");
          recRunning = false;
        } else if (e === "no-speech" || e === "aborted") {
          // expected lulls — onend will restart
        } else {
          console.warn("[landing] stt error:", e);
        }
      };
      rec.onend = () => {
        if (!recRunning) return;
        try {
          rec.start();
        } catch {
          /* already running */
        }
      };
      // Mic requires a user gesture to actually start in some browsers.
      // Try immediately; if it throws (no gesture yet), arm a one-shot.
      const tryStart = () => {
        try {
          rec.start();
          recRunning = true;
        } catch {
          /* needs gesture */
        }
      };
      tryStart();
      const armOnGesture = () => {
        if (recRunning) return;
        tryStart();
      };
      window.addEventListener("pointerdown", armOnGesture, { once: true, capture: true });
      window.addEventListener("keydown", armOnGesture, { once: true, capture: true });
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
    startBtn.addEventListener(
      "click",
      () => {
        if (landingRec) {
          recRunning = false;
          try {
            landingRec.stop();
          } catch {
            /* not running */
          }
          landingRec = null;
        }
        root.classList.add("hidden");
        setTimeout(() => root.remove(), 400);
        resolve({ stream, userPickedVoiceURI });
      },
      { once: true },
    );
  });
}
