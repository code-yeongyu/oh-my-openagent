# WebRTC mic+speaker prototype

Minimal local audio I/O page served by a Bun HTTP+WS server.
Captures microphone, streams PCM to the server, plays back inbound TTS audio.
This is a smoke-test prototype — not the production audio path.
Production wires through T17 session adapter + T11 (Deepgram) / T14 (Cartesia) adapters.

## Run

```bash
bun packages/voice-client/src/webrtc/server.ts
```

Open http://localhost:5174 in a browser. Grant microphone permission when prompted.

Port override: `VOICE_WEBRTC_PORT=5175 bun packages/voice-client/src/webrtc/server.ts`

## What to observe

The page shows three indicators:

- Connection pill — transitions from "connecting" to "connected" then "live" once the mic starts.
- Mic level meter — a bar tracking RMS amplitude in real time.
- VAD indicator — flips from "VAD IDLE" to "VAD ACTIVE" after 3 consecutive frames above the
  energy threshold, and back after 10 frames below. Speak toward the mic to trigger it.

The server echoes a 1kHz test beep for the first 5 inbound audio frames so you can verify the
full mic-to-server-to-browser audio loop on first open. You should hear a short tone within a
second of granting microphone permission.

Speaking while a beep is playing triggers barge-in: playback stops immediately and a
"barge-in" log line appears in the log area.

## Test

```bash
bun test packages/voice-client/src/webrtc/server.test.ts
```

## Architecture note

Outbound audio path: `getUserMedia` at 16kHz mono → AudioWorkletProcessor (40ms frames) →
RMS VAD → nearest-neighbor downsample to 16kHz if needed → Int16 s16le → WebSocket binary.

Inbound audio path: binary WebSocket message (PCM_F32LE @ 44100Hz, Cartesia format) →
`AudioBuffer` → `AudioBufferSourceNode` → `AudioContext.destination`.
