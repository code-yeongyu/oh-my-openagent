import { CartesiaTtsAdapter } from "./providers/cartesia-tts/index.ts";
import { DeepgramSttAdapter } from "./providers/deepgram-stt/adapter.ts";
import { OpencodeSessionAdapter } from "./session/index.ts";
import { startWebRtcServer } from "./webrtc/index.ts";

interface VoiceClientConfig {
  deepgramApiKey: string;
  cartesiaApiKey: string;
  cartesiaVoiceId: string;
  opencodeServerUrl: string;
  webrtcPort: number;
}

function loadConfig(): VoiceClientConfig {
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
  const cartesiaApiKey = process.env.CARTESIA_API_KEY;
  const cartesiaVoiceId = process.env.CARTESIA_VOICE_ID ?? "a0e99841-438c-4a64-b679-ae501e7d6091";
  const opencodeServerUrl = process.env.OPENCODE_SERVER_URL ?? "http://localhost:4096";
  const webrtcPort = Number(process.env.VOICE_WEBRTC_PORT ?? "5174");

  if (!deepgramApiKey) {
    throw new Error("DEEPGRAM_API_KEY is required");
  }
  if (!cartesiaApiKey) {
    throw new Error("CARTESIA_API_KEY is required");
  }
  if (!Number.isFinite(webrtcPort) || webrtcPort <= 0) {
    throw new Error(`VOICE_WEBRTC_PORT must be a positive integer, got "${process.env.VOICE_WEBRTC_PORT}"`);
  }

  return { deepgramApiKey, cartesiaApiKey, cartesiaVoiceId, opencodeServerUrl, webrtcPort };
}

async function run(): Promise<void> {
  const config = loadConfig();

  console.log(`[voice-client] WebRTC page http://localhost:${config.webrtcPort}`);
  console.log(`[voice-client] opencode server ${config.opencodeServerUrl}`);
  console.log(`[voice-client] Deepgram nova-3 (language=multi)`);
  console.log(`[voice-client] Cartesia sonic-3 (language=it)`);

  const stt = new DeepgramSttAdapter({
    apiKey: config.deepgramApiKey,
    model: "nova-3",
    language: "multi",
    endpointingMs: 100,
  });

  const tts = new CartesiaTtsAdapter({
    apiKey: config.cartesiaApiKey,
    model: "sonic-3",
    voice: config.cartesiaVoiceId,
    language: "it",
    container: "raw",
    encoding: "pcm_f32le",
    sampleRate: 44100,
  });

  const session = new OpencodeSessionAdapter({
    serverUrl: config.opencodeServerUrl,
    voiceIntent: true,
  });
  await session.open();

  const server = startWebRtcServer(config.webrtcPort);

  console.log("[voice-client] Adapters initialized.");
  console.log("[voice-client] Open the WebRTC page in your browser, press the mic button, and start speaking.");
  console.log("[voice-client] Streaming wiring is left as a follow-up; the building blocks above are ready.");

  void stt;
  void tts;

  const shutdown = () => {
    console.log("[voice-client] Shutting down.");
    session.close();
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  run().catch((err) => {
    console.error("[voice-client] fatal error:", err);
    process.exit(1);
  });
}
