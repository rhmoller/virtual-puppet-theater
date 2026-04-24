# Virtual Puppet Theater

A virtual puppet theater that runs in your browser. Your webcam tracks your
hand with MediaPipe and animates a puppet on stage. Opposite you, **Clawd** —
a cheerful sock-puppet mascot — reacts to what you say and do, driven by
Claude Opus 4.7.

Built for the "Built with Opus" hackathon.

## Stack

- **Bun** — runtime and package manager
- **Vite** + **TypeScript** (strict) — frontend build
- **three.js** — 3D scene
- **@mediapipe/hands** — hand landmark tracking
- **Web Speech API** — browser speech recognition + synthesis
- **@anthropic-ai/sdk** — Claude Opus 4.7 drives Clawd's dialogue and emotes

## Run it

```sh
bun install
export ANTHROPIC_API_KEY=...     # your Anthropic API key
bun run dev:server               # websocket brain on :3001
bun run dev                      # vite frontend on :5173
```

Open the frontend, grant webcam and microphone access, raise a hand.

## License

MIT — see [LICENSE](./LICENSE).
