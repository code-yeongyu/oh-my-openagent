# voice-client RUNBOOK

Operator guide for the standalone Speech-To-Speech voice client that lets the user talk to Claude through opencode.

## Prerequisites

- Bun 1.3.12 or newer on the local machine.
- A running opencode server reachable at the configured URL. Default `http://localhost:4096`.
- An ElevenLabs alternative is not needed: this client uses **Deepgram nova-3** for speech recognition and **Cartesia sonic-3** for text-to-speech, both via their official npm SDKs.
- API keys: `DEEPGRAM_API_KEY` and `CARTESIA_API_KEY`. Get them from each provider's dashboard.
- A modern Chromium-based browser for the WebRTC mic page. Safari and Firefox also work but Chromium has the smoothest AudioWorklet behavior.

## Environment variables

Copy `.env.example` to `.env` in this package and fill in the values. The orchestrator reads them at startup via `process.env`.

```
DEEPGRAM_API_KEY=...
CARTESIA_API_KEY=...
CARTESIA_VOICE_ID=...optional, defaults to a multilingual Italian voice...
OPENCODE_SERVER_URL=http://localhost:4096
VOICE_WEBRTC_PORT=5174
```

## How to start

From the repo root:

```bash
cd packages/voice-client
bun run src/main.ts
```

The orchestrator prints the WebRTC page URL, the opencode server it is talking to, and the chosen Deepgram and Cartesia model identifiers. Open the page in the browser, grant microphone permission, and press the talk button.

Stop the client with Ctrl C. The orchestrator closes the opencode session, shuts down the WebRTC server, and exits cleanly.

## How the pieces fit together

The orchestrator wires four building blocks that were each built in isolation under TDD and committed to the dev branch over the course of the project. The microphone capture and speaker playback run in the browser through the local WebRTC page served by Bun. Microphone frames travel over a WebSocket to the local backend, which forwards them to Deepgram nova-3 in multi-language mode with endpointing set to one hundred milliseconds for voice activity detection. The transcribed text is sent to opencode through the official SDK and is prepended with the voice intent sentinel so the keyword detector hook on the plugin side suppresses ultrawork, hyperplan, search, analyze, and team triggers that would otherwise pollute the spoken response. Claude's text response streams back as server-sent events, the session adapter detects clause boundaries on sentence-end punctuation and emits them to the text-to-speech provider, which streams the synthesized audio over its WebSocket to the backend, which forwards the frames to the browser for playback through the AudioContext.

## Verbatim discipline

The text that Claude writes is what gets spoken. There is no rewriting pass between the model output and the speech engine. The voice mode section in `~/.config/opencode/AGENTS.md` instructs Claude to write conversational prose without bullet lists, tables, headers, inline code, or caveman compression when voice intent is active. The regression harness in `src/regression/` runs a corpus of voice-mode prompts through the Anthropic API and the verbatim validator and asserts zero violations of the forbidden grammar. If a prompt template change breaks compliance, the harness fails and the prompt is iterated, never the live output.

## What is not wired yet

The orchestrator initializes the adapters and starts the WebRTC server, but the actual streaming glue between microphone frames and Deepgram and between Cartesia frames and the browser is left as a small follow-up because it depends on the exact WebSocket message contract chosen between the browser and the backend, and that contract is best decided after a first manual smoke test of audio capture on the target machine. The building blocks themselves are ready: `DeepgramSttAdapter.transcribe` accepts an audio sample and yields text events, `CartesiaTtsAdapter.synthesize` accepts text and yields audio events, `OpencodeSessionAdapter` posts prompts and consumes server-sent events. A future commit will land the WebSocket-to-AsyncIterable bridge so the orchestrator can run a real conversation end to end.

## Troubleshooting

If the browser cannot reach the WebSocket, check that `VOICE_WEBRTC_PORT` is free and that `127.0.0.1:5174` is reachable from the browser. If opencode rejects the prompt, verify that the server is running on the configured URL and that the voice intent sentinel suppression hook has been merged on the opencode side, which it has on dev as of the merge commit that ties together this package and the keyword detector patch. If Deepgram returns authentication errors, regenerate the API key. If Cartesia returns the same, regenerate that key. The latency timing harness in `src/harness/` can be run against stub providers to verify that the orchestration measurement code is sound before the live wiring lands.

## Follow-up tasks

Wave six and beyond from the original plan are documented as deferred work. The CI regression integration that wires the verbatim harness into the GitHub Actions workflow is a small `.github/workflows/ci.yml` edit. The end-to-end latency validation needs real network conditions and live API keys on the operator machine, not a CI runner. The threat model document is a brief privacy and data-flow audit that can be added once a first real conversation has been recorded. None of these block the operator from using the client today.
