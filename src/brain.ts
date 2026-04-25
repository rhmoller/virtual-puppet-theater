import type { Action, ClientEvent, ServerEvent, VoiceInfo } from "../server/protocol.ts";

export type ConnState = "connected" | "reconnecting" | "disconnected";
export type MicState = "unsupported" | "idle" | "listening" | "denied" | "error";

type Handlers = {
  onAction: (action: Action) => void;
  onCancelSpeech: () => void;
  onVoicePick: (voiceURI: string) => void;
  onConnection?: (state: ConnState) => void;
  onMicState?: (state: MicState) => void;
  onAiThinking?: (thinking: boolean) => void;
  onServerError?: (message: string) => void;
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

  /**
   * Push body-language signal updates to the server. Caller is
   * responsible for diffing and only calling on meaningful change —
   * Brain itself sends every call straight to the wire.
   */
  sendSignal(signal: Omit<Extract<ClientEvent, { type: "signal" }>, "type">) {
    this.send({ type: "signal", ...signal });
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
      this.handlers.onConnection?.("connected");
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
          this.handlers.onAiThinking?.(false);
          this.handlers.onAction(msg.action);
          break;
        case "cancel_speech":
          this.handlers.onCancelSpeech();
          break;
        case "voice_pick":
          this.handlers.onVoicePick(msg.voiceURI);
          break;
        case "error":
          // The server sends a turn-level error (e.g., rate limit or LLM
          // failure). Drop the "thinking" indicator since no action is
          // coming for this turn, and surface a soft message.
          this.handlers.onAiThinking?.(false);
          this.handlers.onServerError?.(msg.message);
          console.warn("[brain] server error:", msg.message);
          break;
      }
    });
    ws.addEventListener("close", () => {
      this.ws = null;
      if (this.stopped) return;
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(delay * 2, 8000);
      this.handlers.onConnection?.("reconnecting");
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
      this.handlers.onMicState?.("unsupported");
      return;
    }
    const rec = new Ctor();
    // Use the browser's preferred locale; hardcoding en-US causes
    // "nomatch" for non-English-locale phones (e.g. da-DK) even when
    // the user speaks clearly. The server prompts Claude in English
    // regardless, but Claude handles multilingual transcripts fine.
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    // Android Chrome silently drops onresult when continuous=true. Use
    // single-utterance mode; onend auto-restarts so the perceived
    // behavior on desktop is the same.
    rec.continuous = false;
    rec.interimResults = true;

    // Permanent denial after permission errors — stop trying to restart.
    let micDenied = false;
    let sttBackoff = 500;

    rec.onresult = (ev) => {
      // Successful results prove the recognizer is healthy — clear any
      // backoff accumulated by prior transient errors.
      sttBackoff = 500;
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
        // A final transcript means the server is about to call Claude.
        if (final) this.handlers.onAiThinking?.(true);
      }
    };
    rec.onend = () => {
      console.log("[stt] end");
      if (this.stopped || micDenied) return;
      // Auto-restart — continuous mode ends itself periodically. Use a
      // small backoff so a tight error/end loop doesn't spin the CPU.
      const delay = sttBackoff;
      sttBackoff = Math.min(sttBackoff * 2, 8000);
      setTimeout(() => {
        if (this.stopped || micDenied) return;
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }, delay);
    };
    rec.onerror = (ev: { error?: string }) => {
      const e = ev.error;
      console.warn("[stt] error:", e);
      if (e === "not-allowed" || e === "service-not-allowed") {
        micDenied = true;
        this.handlers.onMicState?.("denied");
      } else if (e === "network" || e === "audio-capture") {
        this.handlers.onMicState?.("error");
        // onend fires after onerror; the backoff in onend handles restart.
      }
      // no-speech / aborted are normal lulls; let onend silently restart.
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
    extra.onstart = () => {
      console.log("[stt] start");
      sttBackoff = 500; // reset backoff once we successfully start.
      if (!micDenied) this.handlers.onMicState?.("listening");
    };
    extra.onaudiostart = () => console.log("[stt] audiostart");
    // audioend fires on every speech pause in continuous mode — too noisy
    // to expose as a UI state. The mic indicator stays "listening" until a
    // hard error or denial.
    extra.onaudioend = () => console.log("[stt] audioend");
    extra.onsoundstart = () => console.log("[stt] soundstart");
    extra.onsoundend = () => console.log("[stt] soundend");
    extra.onspeechstart = () => console.log("[stt] speechstart");
    extra.onspeechend = () => console.log("[stt] speechend");
    extra.onnomatch = () => console.log("[stt] nomatch");
    this.stt = rec;

    // Brain is only constructed/started after the landing page's Start
    // button — which is the user gesture browsers require. So rec.start()
    // can run immediately. Any "not-allowed" failure surfaces async via
    // onerror, which marks the mic denied; no fallback gesture listener
    // is needed (and start() doesn't throw synchronously on that path).
    try {
      rec.start();
    } catch (err) {
      console.log("[stt] start() threw:", err);
    }
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
    case "signal": {
      const parts = [
        event.gestures?.length ? `g=[${event.gestures.join(",")}]` : null,
        event.pose ? `pose=${event.pose}` : null,
        event.energy ? `energy=${event.energy}` : null,
      ].filter(Boolean);
      return `signal: ${parts.join(" ") || "(empty)"}`;
    }
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
