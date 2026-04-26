import type { BrainSize, ClientEvent, ServerEvent } from "./protocol.ts";
import { AnthropicBackend } from "./llm.ts";
import { Session } from "./session.ts";
import { AssetGenerator } from "./asset-generator.ts";
import { synthesize } from "./tts.ts";
import {
  IpConnectionCounter,
  GlobalCeiling,
  clientIpFrom,
  originAllowed,
} from "./limits.ts";

const PORT = Number(process.env.PORT ?? 3001);
// Map brain size choice → Claude model. Defaults to large/Opus when the
// query param is missing or unrecognized.
const MODEL_FOR_BRAIN: Record<BrainSize, string> = {
  large: "claude-opus-4-7",
  small: "claude-haiku-4-5-20251001",
};
// Shared abuse limits. Per-session budget is created inside each Session.
const ipCounter = new IpConnectionCounter();
const globalCeiling = new GlobalCeiling();
// Shared asset designer — one per process so the cache is shared across
// all sessions. Always uses Opus 4.7, regardless of any session's
// brain-size toggle.
const assetGenerator = new AssetGenerator();

type SocketData = { session: Session; ip: string; brain: BrainSize };

// In production the server also serves the built frontend from ./dist; in
// dev Vite owns the frontend and proxies /ws here.
const STATIC_DIR = "./dist";

const server = Bun.serve<SocketData, string>({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (!originAllowed(req.headers)) {
        return new Response("forbidden", { status: 403 });
      }
      const ip = clientIpFrom(req.headers);
      if (!ipCounter.tryAcquire(ip)) {
        return new Response("too many connections", { status: 429 });
      }
      // Brain size travels in the WS query string — we need it at session
      // construction time (the opening prompt fires before any messages).
      const brain: BrainSize = url.searchParams.get("brain") === "small" ? "small" : "large";
      const upgraded = srv.upgrade(req, {
        data: { session: undefined as unknown as Session, ip, brain },
      });
      if (upgraded) return undefined;
      // Upgrade rejected for some other reason — release the slot we took.
      ipCounter.release(ip);
      return new Response("upgrade failed", { status: 400 });
    }
    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (url.pathname === "/tts" && req.method === "POST") {
      if (!originAllowed(req.headers)) {
        return new Response("forbidden", { status: 403 });
      }
      let text: string;
      try {
        const body = (await req.json()) as { text?: unknown };
        if (typeof body.text !== "string" || body.text.length === 0) {
          return new Response("missing text", { status: 400 });
        }
        // Clawd's lines are short; cap at 600 to keep cost predictable
        // and reject obvious abuse.
        text = body.text.slice(0, 600);
      } catch {
        return new Response("invalid json", { status: 400 });
      }
      try {
        const audio = await synthesize(text);
        return new Response(new Blob([audio], { type: "audio/mpeg" }), {
          headers: { "cache-control": "no-store" },
        });
      } catch (err) {
        console.warn("[tts] synthesize failed:", err);
        return new Response("tts failed", { status: 502 });
      }
    }

    // Static file serving. Reject any path containing ".." as a cheap
    // traversal guard; URL normalization already strips most of them but
    // this is belt-and-braces for the file-system read below.
    if (url.pathname.includes("..")) {
      return new Response("not found", { status: 404 });
    }
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${STATIC_DIR}${rel}`);
    if (await file.exists()) return new Response(file);

    // SPA fallback so client-side routing / deep links land on index.html.
    const index = Bun.file(`${STATIC_DIR}/index.html`);
    if (await index.exists()) return new Response(index);

    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const send = (event: ServerEvent) => {
        console.log("[ws →]", formatServerEvent(event));
        ws.send(JSON.stringify(event));
      };
      const llm = new AnthropicBackend(MODEL_FOR_BRAIN[ws.data.brain]);
      ws.data.session = new Session(llm, send, globalCeiling, assetGenerator);
      console.log(`[ws] open (brain=${ws.data.brain}, model=${llm.name})`);
    },
    message(ws, raw) {
      let event: ClientEvent;
      try {
        event = JSON.parse(String(raw));
      } catch {
        console.warn("[ws ←] invalid JSON:", String(raw).slice(0, 120));
        return;
      }
      console.log("[ws ←]", formatClientEvent(event));
      ws.data.session.handle(event);
    },
    close(ws) {
      ws.data.session?.close();
      ipCounter.release(ws.data.ip);
      console.log("[ws] close");
    },
  },
});

function formatClientEvent(event: ClientEvent): string {
  switch (event.type) {
    case "transcript":
      return `transcript${event.final ? "(final)" : "(partial)"}: ${JSON.stringify(event.text)}`;
    case "user_speaking":
      return `user_speaking: ${event.speaking}`;
    case "puppet_state":
      return `puppet_state: visible=${event.visible}`;
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
      const meta = [
        a.emotion,
        a.gaze && `gaze=${a.gaze}`,
        a.gesture && `gesture=${a.gesture}`,
        a.effects?.length ? `fx=${a.effects.length}` : null,
      ]
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
    case "asset_ready":
      return `asset_ready: ${event.asset_name} (req=${event.request_id}, parts=${event.spec.parts.length})`;
  }
}

console.log(`[server] listening on http://localhost:${server.port}`);
console.log(`[server] WS endpoint: ws://localhost:${server.port}/ws`);
console.log(
  `[server] models: large=${MODEL_FOR_BRAIN.large}, small=${MODEL_FOR_BRAIN.small}`,
);
