// src/hud.ts — Persistent on-screen status. Three dots (camera, mic, AI),
// a sticky banner for connection state, and transient toasts for soft
// errors (rate-limit, transient backend hiccups). Pure DOM, no framework.

export type Status = "idle" | "ok" | "warn" | "err";
export type AiState = "idle" | "thinking" | "speaking";
export type ConnState = "connected" | "reconnecting" | "disconnected";

export class Hud {
  private camDot: HTMLSpanElement;
  private micDot: HTMLSpanElement;
  private aiDot: HTMLSpanElement;
  private banner: HTMLDivElement;
  private toasts: HTMLDivElement;

  constructor() {
    const root = document.createElement("div");
    root.id = "hud";
    root.innerHTML = `
      <div class="hud-banner" hidden></div>
      <div class="hud-toasts"></div>
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
