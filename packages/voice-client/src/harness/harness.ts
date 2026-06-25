import type {
  AudioSample,
  IterationError,
  Percentiles,
  RunResult,
  SttStub,
  StageTiming,
  TtsStub,
} from "./types.ts";

export interface RunHarnessOptions {
  stt: SttStub;
  tts: TtsStub;
  samples: AudioSample[];
  iterations: number;
  signal?: AbortSignal;
  onError?: (err: IterationError) => void;
}

export async function runHarness(opts: RunHarnessOptions): Promise<RunResult> {
  if (opts.samples.length === 0) {
    throw new Error("runHarness: no samples provided");
  }
  if (opts.iterations <= 0) {
    throw new Error("runHarness: iterations must be > 0");
  }
  throwIfAborted(opts.signal);

  const collected: StageTiming[] = [];

  for (let iter = 0; iter < opts.iterations; iter++) {
    for (const sample of opts.samples) {
      throwIfAborted(opts.signal);
      try {
        const timing = await measureOne(opts.stt, opts.tts, sample);
        collected.push(timing);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (isAbortError(cause)) {
          throw cause;
        }
        opts.onError?.({
          iteration: iter,
          sample_id: sample.id,
          stage: inferStage(message),
          message,
        });
      }
    }
  }

  if (collected.length === 0) {
    throw new Error("runHarness: zero iterations succeeded");
  }

  return {
    perStage: {
      stt_first_token: percentilesOf(collected.map((t) => t.stt_first_token_ms)),
      stt_complete: percentilesOf(collected.map((t) => t.stt_complete_ms)),
      tts_first_byte: percentilesOf(collected.map((t) => t.tts_first_byte_ms)),
      tts_first_audio: percentilesOf(collected.map((t) => t.tts_first_audio_ms)),
      end_to_end: percentilesOf(collected.map((t) => t.end_to_end_ms)),
    },
    iterations: opts.iterations,
    samples_used: opts.samples.length,
    timestamp_iso: new Date().toISOString(),
  };
}

async function measureOne(
  stt: SttStub,
  tts: TtsStub,
  sample: AudioSample,
): Promise<StageTiming> {
  const t0 = performance.now();
  let sttFirstToken = -1;
  let sttComplete = -1;
  let finalText = "";

  for await (const ev of stt.transcribe(sample)) {
    const t = performance.now() - t0;
    if (ev.kind === "partial" && sttFirstToken < 0) {
      sttFirstToken = t;
    } else if (ev.kind === "final") {
      if (sttFirstToken < 0) {
        sttFirstToken = t;
      }
      sttComplete = t;
      finalText = ev.text;
    }
  }

  if (sttComplete < 0) {
    throw new Error("stt: no final event received");
  }

  let ttsFirstByte = -1;
  let ttsFirstAudio = -1;

  for await (const ev of tts.synthesize(finalText)) {
    const t = performance.now() - t0;
    if (ev.kind === "first_byte" && ttsFirstByte < 0) {
      ttsFirstByte = t;
    } else if (ev.kind === "audio_chunk" && ttsFirstAudio < 0) {
      ttsFirstAudio = t;
      break;
    }
  }

  if (ttsFirstAudio < 0) {
    throw new Error("tts: no audio chunk received");
  }

  const endToEnd = performance.now() - t0;
  return {
    stt_first_token_ms: sttFirstToken,
    stt_complete_ms: sttComplete,
    tts_first_byte_ms: ttsFirstByte < 0 ? ttsFirstAudio : ttsFirstByte,
    tts_first_audio_ms: ttsFirstAudio,
    end_to_end_ms: endToEnd,
  };
}

function inferStage(message: string): "stt" | "tts" | "unknown" {
  if (message.startsWith("stt:")) return "stt";
  if (message.startsWith("tts:")) return "tts";
  return "unknown";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const err = new Error("AbortError");
    err.name = "AbortError";
    throw err;
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

export function percentilesOf(values: readonly number[]): Percentiles {
  if (values.length === 0) {
    return { p50: 0, p95: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const last = sorted.length - 1;
  const p50Index = Math.min(Math.floor(sorted.length * 0.5), last);
  const p95Index = Math.min(Math.floor(sorted.length * 0.95), last);
  return {
    p50: sorted[p50Index] ?? 0,
    p95: sorted[p95Index] ?? 0,
  };
}
