# Virtual Puppet Theater

A virtual puppet theater that runs in your browser. Your webcam tracks your
hand with MediaPipe and animates a puppet on stage. Opposite you, a
cheerful AI-driven hand-puppet reacts to what you say and do, driven by
Claude Opus 4.7.

Built for the "Built with Opus" hackathon.

## Stack

- **Bun** — runtime and package manager
- **Vite** + **TypeScript** (strict) — frontend build
- **three.js** — 3D scene
- **@mediapipe/hands** — hand landmark tracking
- **Web Speech API** — browser speech recognition; browser synthesis as TTS fallback
- **@elevenlabs/elevenlabs-js** — primary TTS, gives the AI puppet an expressive voice
- **@anthropic-ai/sdk** — Claude Opus 4.7 drives the AI puppet's dialogue and emotes

## Run it

```sh
bun install
export ANTHROPIC_API_KEY=...     # your Anthropic API key
export ELEVENLABS_API_KEY=...    # your ElevenLabs API key (for the puppet's voice)
bun run dev:server               # websocket brain on :3001
bun run dev                      # vite frontend on :5173
```

Open the frontend, grant webcam and microphone access, raise a hand.

## License

MIT — see [LICENSE](./LICENSE).
