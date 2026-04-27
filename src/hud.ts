// src/hud.ts — Persistent on-screen status. Three dots (camera, mic, AI),
// a sticky banner for connection state, and transient toasts for soft
// errors (rate-limit, transient backend hiccups). Pure DOM, no framework.

export type Status = "idle" | "ok" | "warn" | "err";
export type AiState = "idle" | "thinking" | "speaking";
export type ConnState = "connected" | "reconnecting" | "disconnected";
export type SttState = "idle" | "listening" | "hearing" | "denied" | "unsupported" | "error";

export class Hud {
  private camDot: HTMLSpanElement;
  private micDot: HTMLSpanElement;
  private aiDot: HTMLSpanElement;
  private banner: HTMLDivElement;
  private toasts: HTMLDivElement;
  private dreaming: HTMLDivElement;
  private dreamingLabel: HTMLSpanElement;
  private dreamingCount = 0;
  private stt: HTMLDivElement;
  private sttStatus: HTMLSpanElement;
  private sttText: HTMLSpanElement;
  private transcriptHideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const root = document.createElement("div");
    root.id = "hud";
    root.innerHTML = `
      <div class="hud-banner" hidden></div>
      <div class="hud-toasts"></div>
      <div class="hud-stt" data-state="idle">
        <span class="hud-stt-status">STT idle</span>
        <span class="hud-stt-text" hidden></span>
      </div>
      <div class="hud-dreaming" hidden>
        <span class="hud-dreaming-icon">✨</span>
        <span class="hud-dreaming-label">Building new prop…</span>
      </div>
      <div class="hud-bar">
        <span class="hud-item"><span class="hud-dot" data-id="cam" data-status="idle"></span> CAM</span>
        <span class="hud-item"><span class="hud-dot" data-id="mic" data-status="idle"></span> MIC</span>
        <span class="hud-item"><span class="hud-dot" data-id="ai"  data-status="idle"></span> AI</span>
      </div>
    `;
    document.body.appendChild(root);
    this.camDot = root.querySelector('[data-id="cam"]') as HTMLSpanElement;
    this.micDot = root.querySelector('[data-id="mic"]') as HTMLSpanElement;
    this.aiDot = root.querySelector('[data-id="ai"]') as HTMLSpanElement;
    this.banner = root.querySelector(".hud-banner") as HTMLDivElement;
    this.toasts = root.querySelector(".hud-toasts") as HTMLDivElement;
    this.dreaming = root.querySelector(".hud-dreaming") as HTMLDivElement;
    this.dreamingLabel = root.querySelector(".hud-dreaming-label") as HTMLSpanElement;
    this.stt = root.querySelector(".hud-stt") as HTMLDivElement;
    this.sttStatus = root.querySelector(".hud-stt-status") as HTMLSpanElement;
    this.sttText = root.querySelector(".hud-stt-text") as HTMLSpanElement;
  }

  setStt(state: SttState, detail?: string) {
    this.stt.dataset.state = state;
    const labels: Record<SttState, string> = {
      idle: "STT idle",
      listening: "STT listening",
      hearing: "STT hearing",
      denied: "STT blocked",
      unsupported: "STT unsupported",
      error: "STT error",
    };
    this.sttStatus.textContent = detail ?? labels[state];
  }

  /** Show the live (or final) transcript next to the STT status.
   *  Final transcripts auto-fade after a short delay; partials persist
   *  until replaced or cleared. Empty text clears the chip immediately. */
  setTranscript(text: string, final: boolean) {
    if (this.transcriptHideTimer !== null) {
      clearTimeout(this.transcriptHideTimer);
      this.transcriptHideTimer = null;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      this.sttText.hidden = true;
      this.sttText.textContent = "";
      this.sttText.dataset.final = "false";
      return;
    }
    this.sttText.hidden = false;
    this.sttText.textContent = trimmed;
    this.sttText.dataset.final = String(final);
    if (final) {
      this.transcriptHideTimer = setTimeout(() => {
        this.sttText.hidden = true;
        this.sttText.textContent = "";
        this.transcriptHideTimer = null;
      }, 4000);
    }
  }

  setCamera(s: Status, label?: string) {
    this.set(this.camDot, s, label);
  }
  setMic(s: Status, label?: string) {
    this.set(this.micDot, s, label);
  }
  setAi(state: AiState) {
    const s: Status = state === "thinking" ? "warn" : state === "speaking" ? "ok" : "idle";
    this.set(this.aiDot, s, `AI ${state}`);
  }

  setConnection(state: ConnState) {
    if (state === "connected") {
      this.hideBanner();
    } else if (state === "reconnecting") {
      this.showBanner("Reconnecting to AI…");
    } else {
      this.showBanner("AI disconnected — reconnecting…");
    }
  }

  /** Increment the in-flight asset-generation count and show the
   *  dreaming chip. Pair with endDreaming() per request. */
  startDreaming() {
    this.dreamingCount += 1;
    this.renderDreaming();
  }

  /** Decrement the count; hides the chip when it reaches 0. Idempotent
   *  at zero so a stray endDreaming() can't drive the count negative. */
  endDreaming() {
    this.dreamingCount = Math.max(0, this.dreamingCount - 1);
    this.renderDreaming();
  }

  private renderDreaming() {
    if (this.dreamingCount === 0) {
      this.dreaming.hidden = true;
    } else {
      this.dreaming.hidden = false;
      this.dreamingLabel.textContent =
        this.dreamingCount > 1
          ? `Building new props ×${this.dreamingCount}…`
          : "Building new prop…";
    }
  }

  toast(text: string, ms = 4000) {
    const t = document.createElement("div");
    t.className = "hud-toast";
    t.textContent = text;
    this.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  private set(dot: HTMLElement, s: Status, label?: string) {
    dot.dataset.status = s;
    if (label) dot.title = label;
  }

  private showBanner(text: string) {
    this.banner.textContent = text;
    this.banner.hidden = false;
  }
  private hideBanner() {
    this.banner.hidden = true;
  }
}
