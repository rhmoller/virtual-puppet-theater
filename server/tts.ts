// server/tts.ts — ElevenLabs TTS. Returns MP3 bytes for a given text.
// Voice is fixed per process via STAGE_VOICE_ID; model is the low-latency
// flash model so the puppet doesn't feel like it's thinking before each line.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Default is George — narrator-ish; override via env once a better voice
// is auditioned in the dashboard.
const VOICE_ID = process.env.STAGE_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
const MODEL_ID = process.env.STAGE_TTS_MODEL ?? "eleven_flash_v2_5";

let cachedClient: ElevenLabsClient | null = null;
function getClient(): ElevenLabsClient {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY is not set; TTS is disabled.");
  }
  if (!cachedClient) cachedClient = new ElevenLabsClient();
  return cachedClient;
}

export async function synthesize(text: string): Promise<ArrayBuffer> {
  const startedAt = performance.now();
  console.log("[tts] eleven request", {
    voiceId: VOICE_ID,
    modelId: MODEL_ID,
    chars: text.length,
    text,
  });
  const stream = await getClient().textToSpeech.convert(VOICE_ID, {
    text,
    modelId: MODEL_ID,
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(new ArrayBuffer(total));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  console.log("[tts] eleven response", {
    chars: text.length,
    bytes: total,
    ms: Math.round(performance.now() - startedAt),
  });
  return out.buffer as ArrayBuffer;
}
