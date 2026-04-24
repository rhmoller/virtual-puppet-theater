import type { Action, ClientEvent, ServerEvent, VoiceInfo } from "../server/protocol.ts";

type Handlers = {
  onAction: (action: Action) => void;
  onCancelSpeech: () => void;
  onVoicePick: (voiceURI: string) => void;
};

export class Brain {
  private ws: WebSocket | null = null;
  private reconnectDelay = 500;
  private stt: SpeechRecognitionLike | null = null;
  private puppetState = { leftVisible: false, rightVisible: false };
  private puppetStateDirty = false;
  private clientReady = false;
  private stopped = false;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Voice list may arrive before the WS is open — hold and flush on open.
  private pendingVoiceList: VoiceInfo[] | null = null;

  constructor(
    private url: string,
    private handlers: Handlers,
  ) {}

  start() {
    this.stopped = false;
    this.connect();
    this.startSTT();
    // Flush puppet-state changes at most 4×/sec.
    this.flushInterval = setInterval(() => {
      if (this.puppetStateDirty) {
        this.send({ type: "puppet_state", ...this.puppetState });
        this.puppetStateDirty = false;
      }
    }, 250);
  }

  stop() {
    this.stopped = true;
    if (this.flushInterval !== null) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.stt) {
      try {
        this.stt.stop();
      } catch {
        /* not started */
      }
      this.stt = null;
    }
  }

  markReady() {
    if (this.clientReady) return;
    this.clientReady = true;
    if (this.ws?.readyState === WebSocket.OPEN) this.send({ type: "hello" });
  }

  notifyPuppetVisible(leftVisible: boolean, rightVisible: boolean) {
    if (
      leftVisible === this.puppetState.leftVisible &&
      rightVisible === this.puppetState.rightVisible
    ) {
      return;
    }
    this.puppetState = { leftVisible, rightVisible };
    this.puppetStateDirty = true;
  }

  sendVoiceList(voices: VoiceInfo[]) {
    this.pendingVoiceList = voices;
    this.flushVoiceList();
  }

  private flushVoiceList() {
    if (this.pendingVoiceList && this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: "voice_list", voices: this.pendingVoiceList });
      this.pendingVoiceList = null;
    }
  }

  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.reconnectDelay = 500;
      if (this.clientReady) this.send({ type: "hello" });
      this.flushVoiceList();
    });
    ws.addEventListener("message", (ev) => {
      let msg: ServerEvent;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      console.log("[ws ←]", formatServerEvent(msg));
      switch (msg.type) {
        case "action":
          this.handlers.onAction(msg.action);
          break;
        case "cancel_speech":
          this.handlers.onCancelSpeech();
          break;
        case "voice_pick":
          this.handlers.onVoicePick(msg.voiceURI);
          break;
        case "error":
          console.warn("[brain] server error:", msg.message);
          break;
      }
    });
    ws.addEventListener("close", () => {
      this.ws = null;
      if (this.stopped) return;
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(delay * 2, 8000);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    });
    ws.addEventListener("error", () => ws.close());
  }

  private send(event: ClientEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log("[ws →]", formatClientEvent(event));
      this.ws.send(JSON.stringify(event));
    }
  }

  private startSTT() {
    if (typeof window === "undefined") return;
    const Ctor: SpeechRecognitionCtor | undefined =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
        .webkitSpeechRecognition;
    if (!Ctor) {
      console.warn("[brain] SpeechRecognition not available in this browser");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (!result) continue;
        const alt = result[0];
        if (!alt) continue;
        const text = alt.transcript;
        const final = result.isFinal;
        const confidence = (alt as { confidence?: number }).confidence;
        console.log(`[stt] ${final ? "final" : "partial"}`, {
          text,
          confidence,
        });
        if (!text.trim()) continue;
        this.send({ type: "transcript", text, final });
        if (!final && text.trim().length > 0) {
          this.send({ type: "user_speaking", speaking: true });
        }
      }
    };
    rec.onend = () => {
      console.log("[stt] end");
      if (this.stopped) return;
      // Auto-restart — continuous mode ends itself periodically.
      try {
        rec.start();
      } catch {
        /* already started */
      }
    };
    rec.onerror = (ev: { error?: string }) => {
      console.warn("[stt] error:", ev.error);
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        console.warn("[brain] mic permission denied");
      }
    };
    // Lifecycle events not in the minimal ambient type — attach via cast.
    const extra = rec as unknown as {
      onstart: (() => void) | null;
      onaudiostart: (() => void) | null;
      onaudioend: (() => void) | null;
      onsoundstart: (() => void) | null;
      onsoundend: (() => void) | null;
      onspeechstart: (() => void) | null;
      onspeechend: (() => void) | null;
      onnomatch: (() => void) | null;
    };
    extra.onstart = () => console.log("[stt] start");
    extra.onaudiostart = () => console.log("[stt] audiostart");
    extra.onaudioend = () => console.log("[stt] audioend");
    extra.onsoundstart = () => console.log("[stt] soundstart");
    extra.onsoundend = () => console.log("[stt] soundend");
    extra.onspeechstart = () => console.log("[stt] speechstart");
    extra.onspeechend = () => console.log("[stt] speechend");
    extra.onnomatch = () => console.log("[stt] nomatch");
    this.stt = rec;

    // Mic requires a user gesture on most browsers — arm a one-shot starter.
    const startOnGesture = () => {
      console.log("[stt] requesting start (user gesture)");
      try {
        rec.start();
      } catch (err) {
        console.log("[stt] start() threw:", err);
      }
    };
    window.addEventListener("pointerdown", startOnGesture, { once: true });
    window.addEventListener("keydown", startOnGesture, { once: true });
  }
}

function formatClientEvent(event: ClientEvent): string {
  switch (event.type) {
    case "transcript":
      return `transcript${event.final ? "(final)" : "(partial)"}: ${JSON.stringify(event.text)}`;
    case "user_speaking":
      return `user_speaking: ${event.speaking}`;
    case "puppet_state":
      return `puppet_state: L=${event.leftVisible} R=${event.rightVisible}`;
    case "voice_list":
      return `voice_list: ${event.voices.length} voices`;
    case "hello":
      return "hello";
  }
}

function formatServerEvent(event: ServerEvent): string {
  switch (event.type) {
    case "action": {
      const a = event.action;
      const meta = [a.emotion, a.gaze && `gaze=${a.gaze}`, a.gesture && `gesture=${a.gesture}`]
        .filter(Boolean)
        .join(" ");
      return `action: ${JSON.stringify(a.say ?? "")}${meta ? ` [${meta}]` : ""}`;
    }
    case "cancel_speech":
      return "cancel_speech";
    case "error":
      return `error: ${event.message}`;
    case "voice_pick":
      return `voice_pick: ${event.voiceURI}`;
  }
}

// Minimal ambient types for Web Speech Recognition (not in lib.dom yet in all TS versions).
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
    [index: number]: { transcript: string };
  }>;
}
