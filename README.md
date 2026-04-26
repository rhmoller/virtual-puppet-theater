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

## Requirements

**Hardware**

- A **webcam** — MediaPipe needs it to track your hand.
- A **microphone** — speech input drives the conversation.

**Browser**

- **Chrome** or **Edge** on desktop. The Web Speech API used for speech
  recognition is best supported there; Firefox and Safari are
  hit-or-miss.
- **HTTPS or `http://localhost`** — `getUserMedia` (camera/mic access)
  refuses to run on insecure origins.

**API keys**

- **`ANTHROPIC_API_KEY`** *(required)* — the AI puppet's brain runs on
  Claude. Get one at [console.anthropic.com](https://console.anthropic.com).
- **`ELEVENLABS_API_KEY`** *(optional)* — gives the puppet an expressive
  voice. Without it, the app falls back to your browser's built-in
  speech synthesis (functional, but flat). Get one at
  [elevenlabs.io](https://elevenlabs.io).

**Computer specs**

The browser does a lot of work on-device: MediaPipe's hand-tracking
runs in WASM on your CPU every frame, and Three.js renders the stage
at 60 fps on the GPU. A reasonably modern machine handles it
comfortably; older or low-power hardware will lag.

## Run it

```sh
bun install
export ANTHROPIC_API_KEY=...     # required
export ELEVENLABS_API_KEY=...    # optional — better voice
bun run dev:server               # websocket brain on :3001
bun run dev                      # vite frontend on :5173
```

Open the frontend, grant webcam and microphone access, raise a hand.

## License

MIT — see [LICENSE](./LICENSE).
