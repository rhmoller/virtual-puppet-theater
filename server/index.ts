import type { ClientEvent, ServerEvent } from "./protocol.ts";
import { AnthropicBackend } from "./llm.ts";
import { Session } from "./session.ts";

const PORT = Number(process.env.PORT ?? 3001);
const llm = new AnthropicBackend();

type SocketData = { session: Session };

// In production the server also serves the built frontend from ./dist; in
// dev Vite owns the frontend and proxies /ws here.
const STATIC_DIR = "./dist";

const server = Bun.serve<SocketData, string>({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = srv.upgrade(req, {
        data: { session: undefined as unknown as Session },
      });
      if (upgraded) return undefined;
      return new Response("upgrade failed", { status: 400 });
    }
    if (url.pathname === "/health") {
      return new Response("ok");
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
      ws.data.session = new Session(llm, send);
      console.log("[ws] open");
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

console.log(`[server] listening on http://localhost:${server.port}`);
console.log(`[server] WS endpoint: ws://localhost:${server.port}/ws`);
console.log(`[server] LLM backend: ${llm.name}`);
