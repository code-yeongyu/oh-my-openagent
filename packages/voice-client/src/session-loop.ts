import type { SttEvent, TtsEvent } from "./harness/types.ts";
import type { SessionAdapterHandle } from "./session/types.ts";

export interface VoiceLoopStt {
  streamLive(
    frames: AsyncIterable<ArrayBuffer>,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<SttEvent>;
}

export interface VoiceLoopTts {
  synthesize(text: string): AsyncIterable<TtsEvent>;
}

export interface VoiceLoopSession
  extends Pick<SessionAdapterHandle, "sendPrompt" | "events"> {}

export interface VoiceLoopDeps {
  stt: VoiceLoopStt;
  session: VoiceLoopSession;
  tts: VoiceLoopTts;
  mic: AsyncIterable<ArrayBuffer>;
  onAudioOut: (bytes: Uint8Array) => void;
  signal?: AbortSignal;
}

export async function runVoiceLoop(deps: VoiceLoopDeps): Promise<void> {
  throwIfAborted(deps.signal);
  const sttEvents = deps.stt.streamLive(deps.mic, { signal: deps.signal });
  for await (const sttEvent of sttEvents) {
    throwIfAborted(deps.signal);
    if (sttEvent.kind !== "final") continue;
    await handleUtterance(sttEvent.text, deps);
  }
}

async function handleUtterance(
  text: string,
  deps: VoiceLoopDeps,
): Promise<void> {
  await deps.session.sendPrompt(text);
  for await (const sessionEvent of deps.session.events()) {
    throwIfAborted(deps.signal);
    if (sessionEvent.kind === "clause-boundary") {
      await synthesizeClause(sessionEvent.text, deps);
    } else if (sessionEvent.kind === "session-idle") {
      return;
    } else if (sessionEvent.kind === "session-error") {
      return;
    }
  }
}

async function synthesizeClause(
  text: string,
  deps: VoiceLoopDeps,
): Promise<void> {
  for await (const ttsEvent of deps.tts.synthesize(text)) {
    throwIfAborted(deps.signal);
    if (ttsEvent.kind === "audio_chunk" && ttsEvent.bytes) {
      deps.onAudioOut(ttsEvent.bytes);
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const err = new Error("AbortError");
    err.name = "AbortError";
    throw err;
  }
}
