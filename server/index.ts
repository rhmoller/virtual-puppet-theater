import type { ClientEvent, ServerEvent } from "./protocol.ts";
import { LMStudioBackend } from "./llm.ts";
import { Session } from "./session.ts";

const PORT = Number(process.env.PORT ?? 3001);
const llm = new LMStudioBackend();

type SocketData = { session: Session };

const server = Bun.serve<SocketData, string>({
  port: PORT,
  fetch(req, srv) {
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
  }
}

console.log(`[server] listening on http://localhost:${server.port}`);
console.log(`[server] WS endpoint: ws://localhost:${server.port}/ws`);
console.log(`[server] LLM backend: ${llm.name}`);
