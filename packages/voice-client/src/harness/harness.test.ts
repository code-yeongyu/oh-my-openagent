import { describe, expect, test } from "bun:test";
import { percentilesOf, runHarness } from "./harness.ts";
import type { AudioSample, IterationError, SttStub, TtsStub } from "./types.ts";

function fixedSttStub(opts: {
  partialMs: number;
  finalMs: number;
  finalText: string;
}): SttStub {
  return {
    async *transcribe() {
      await delay(opts.partialMs);
      yield { kind: "partial" as const, text: "...", t_ms: opts.partialMs };
      await delay(opts.finalMs - opts.partialMs);
      yield { kind: "final" as const, text: opts.finalText, t_ms: opts.finalMs };
    },
  };
}

function fixedTtsStub(opts: { firstByteMs: number; firstAudioMs: number }): TtsStub {
  return {
    async *synthesize() {
      await delay(opts.firstByteMs);
      yield { kind: "first_byte" as const, t_ms: opts.firstByteMs };
      await delay(opts.firstAudioMs - opts.firstByteMs);
      yield {
        kind: "audio_chunk" as const,
        t_ms: opts.firstAudioMs,
        bytes: new Uint8Array([0]),
      };
    },
  };
}

function failingSttStub(failOnIter: number): SttStub {
  let iter = 0;
  return {
    async *transcribe() {
      iter += 1;
      if (iter === failOnIter) {
        throw new Error("stt: stub forced failure");
      }
      yield { kind: "final" as const, text: "ok", t_ms: 5 };
    },
  };
}

function alwaysFailingTtsStub(): TtsStub {
  return {
    async *synthesize() {
      throw new Error("tts: stub always fails");
    },
  };
}

function sample(id: string, lang: AudioSample["lang"] = "it"): AudioSample {
  return { id, lang, wavPath: `/tmp/${id}.wav` };
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runHarness", () => {
  test("#given stub STT+TTS with fixed timings #when 3 iterations on 1 sample #then iterations and samples_used are reported", async () => {
    const stt = fixedSttStub({ partialMs: 5, finalMs: 10, finalText: "ciao" });
    const tts = fixedTtsStub({ firstByteMs: 5, firstAudioMs: 15 });
    const result = await runHarness({
      stt,
      tts,
      samples: [sample("s1")],
      iterations: 3,
    });
    expect(result.iterations).toBe(3);
    expect(result.samples_used).toBe(1);
    expect(typeof result.timestamp_iso).toBe("string");
  });

  test("#given STT throws on iteration 2 of 3 #when runHarness runs #then RunResult is built and onError callback records the failure", async () => {
    const stt = failingSttStub(2);
    const tts = fixedTtsStub({ firstByteMs: 1, firstAudioMs: 2 });
    const errors: IterationError[] = [];
    const result = await runHarness({
      stt,
      tts,
      samples: [sample("s1")],
      iterations: 3,
      onError: (e) => errors.push(e),
    });
    expect(errors.length).toBe(1);
    expect(errors[0]?.stage).toBe("stt");
    expect(result.iterations).toBe(3);
  });

  test("#given TTS throws on every iteration #when runHarness runs #then it throws because zero iterations completed", async () => {
    const stt = fixedSttStub({ partialMs: 0, finalMs: 1, finalText: "x" });
    const tts = alwaysFailingTtsStub();
    await expect(
      runHarness({ stt, tts, samples: [sample("s1")], iterations: 2 }),
    ).rejects.toThrow(/zero iterations/);
  });

  test("#given mixed counts 3 iterations × 2 samples #when runHarness runs #then percentile end_to_end p95 >= p50", async () => {
    const stt = fixedSttStub({ partialMs: 1, finalMs: 2, finalText: "x" });
    const tts = fixedTtsStub({ firstByteMs: 1, firstAudioMs: 2 });
    const result = await runHarness({
      stt,
      tts,
      samples: [sample("a"), sample("b")],
      iterations: 3,
    });
    expect(result.perStage.end_to_end.p50).toBeGreaterThan(0);
    expect(result.perStage.end_to_end.p95).toBeGreaterThanOrEqual(
      result.perStage.end_to_end.p50,
    );
  });

  test("#given empty samples array #when runHarness runs #then it throws no-samples error", async () => {
    const stt = fixedSttStub({ partialMs: 0, finalMs: 1, finalText: "x" });
    const tts = fixedTtsStub({ firstByteMs: 1, firstAudioMs: 2 });
    await expect(
      runHarness({ stt, tts, samples: [], iterations: 1 }),
    ).rejects.toThrow(/no samples provided/);
  });

  test("#given iterations=0 #when runHarness runs #then it throws iterations-must-be-positive error", async () => {
    const stt = fixedSttStub({ partialMs: 0, finalMs: 1, finalText: "x" });
    const tts = fixedTtsStub({ firstByteMs: 1, firstAudioMs: 2 });
    await expect(
      runHarness({ stt, tts, samples: [sample("s1")], iterations: 0 }),
    ).rejects.toThrow(/iterations must be > 0/);
  });

  test("#given STT emits partial then final #when runHarness runs #then stt_first_token_ms p50 is less than stt_complete_ms p50", async () => {
    const stt = fixedSttStub({ partialMs: 5, finalMs: 20, finalText: "ciao" });
    const tts = fixedTtsStub({ firstByteMs: 1, firstAudioMs: 2 });
    const result = await runHarness({
      stt,
      tts,
      samples: [sample("s1")],
      iterations: 1,
    });
    expect(result.perStage.stt_first_token.p50).toBeLessThan(
      result.perStage.stt_complete.p50,
    );
  });

  test("#given AbortSignal aborted before run #when runHarness runs #then it throws AbortError", async () => {
    const stt = fixedSttStub({ partialMs: 0, finalMs: 1, finalText: "x" });
    const tts = fixedTtsStub({ firstByteMs: 1, firstAudioMs: 2 });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      runHarness({
        stt,
        tts,
        samples: [sample("s1")],
        iterations: 1,
        signal: ctrl.signal,
      }),
    ).rejects.toThrow(/AbortError/);
  });
});

describe("percentilesOf", () => {
  test("#given empty array #when computed #then returns zeros", () => {
    expect(percentilesOf([])).toEqual({ p50: 0, p95: 0 });
  });

  test("#given ten sequential values #when computed #then p50 is index 5 and p95 is index 9", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r = percentilesOf(values);
    expect(r.p50).toBe(6);
    expect(r.p95).toBe(10);
  });

  test("#given unsorted input #when computed #then sorts before indexing", () => {
    expect(percentilesOf([5, 1, 4, 2, 3])).toEqual({ p50: 3, p95: 5 });
  });
});
