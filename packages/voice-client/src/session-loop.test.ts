import { describe, expect, test } from "bun:test";
import { runVoiceLoop } from "./session-loop.ts";
import type { SttEvent, TtsEvent } from "./harness/types.ts";
import type { SessionAdapterHandle, SessionEvent } from "./session/types.ts";

interface FakeStt {
  pushed: ArrayBuffer[];
  scriptedEvents: SttEvent[];
}

function makeFakeStt(scriptedEvents: SttEvent[]): {
  fake: FakeStt;
  streamLive(frames: AsyncIterable<ArrayBuffer>): AsyncIterable<SttEvent>;
} {
  const fake: FakeStt = { pushed: [], scriptedEvents };
  return {
    fake,
    async *streamLive(frames) {
      const pump = (async () => {
        for await (const chunk of frames) {
          fake.pushed.push(chunk);
        }
      })();
      void pump;
      for (const ev of scriptedEvents) {
        yield ev;
      }
    },
  };
}

interface FakeSession {
  promptsSent: string[];
  scriptedEventsBySend: SessionEvent[][];
  closed: boolean;
}

function makeFakeSession(
  scriptedEventsBySend: SessionEvent[][],
): SessionAdapterHandle & { _fake: FakeSession } {
  const fake: FakeSession = {
    promptsSent: [],
    scriptedEventsBySend,
    closed: false,
  };
  let sendIndex = 0;
  let currentEvents: SessionEvent[] = [];
  return {
    sessionId: "fake-session",
    async sendPrompt(text: string) {
      fake.promptsSent.push(text);
      currentEvents = scriptedEventsBySend[sendIndex] ?? [];
      sendIndex += 1;
      return `msg-${sendIndex}`;
    },
    async *events() {
      for (const ev of currentEvents) {
        yield ev;
        if (ev.kind === "session-idle") return;
      }
    },
    close() {
      fake.closed = true;
    },
    _fake: fake,
  };
}

interface FakeTts {
  synthesized: string[];
}

function makeFakeTts(audioChunks: Uint8Array[]): {
  fake: FakeTts;
  synthesize(text: string): AsyncIterable<TtsEvent>;
} {
  const fake: FakeTts = { synthesized: [] };
  return {
    fake,
    async *synthesize(text) {
      fake.synthesized.push(text);
      yield { kind: "first_byte" as const, t_ms: 0 };
      for (const bytes of audioChunks) {
        yield { kind: "audio_chunk" as const, t_ms: 0, bytes };
      }
    },
  };
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

function chunk(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe("runVoiceLoop", () => {
  test("#given mic frames flow and STT yields a final transcript #when the loop runs #then session.sendPrompt receives that transcript and the mic frames reach the STT", async () => {
    const stt = makeFakeStt([
      { kind: "partial", text: "ciao", t_ms: 10 },
      { kind: "final", text: "ciao Claude", t_ms: 20 },
    ]);
    const session = makeFakeSession([[{ kind: "session-idle", t_ms: 30 }]]);
    const tts = makeFakeTts([]);
    const audioOut: Uint8Array[] = [];
    await runVoiceLoop({
      stt,
      session,
      tts,
      mic: fromArray([chunk([1, 2]), chunk([3, 4])]),
      onAudioOut: (bytes) => audioOut.push(bytes),
    });
    expect(session._fake.promptsSent).toEqual(["ciao Claude"]);
    expect(stt.fake.pushed.length).toBe(2);
    expect(audioOut.length).toBe(0);
  });

  test("#given the session yields a clause-boundary #when the loop runs #then TTS.synthesize is called with that clause text", async () => {
    const stt = makeFakeStt([
      { kind: "final", text: "dimmi una cosa", t_ms: 10 },
    ]);
    const session = makeFakeSession([
      [
        { kind: "text-delta", text: "Ciao ", t_ms: 5 },
        { kind: "clause-boundary", text: "Ciao mondo.", t_ms: 10 },
        { kind: "session-idle", t_ms: 20 },
      ],
    ]);
    const tts = makeFakeTts([new Uint8Array([1, 2, 3])]);
    const audioOut: Uint8Array[] = [];
    await runVoiceLoop({
      stt,
      session,
      tts,
      mic: fromArray([chunk([1])]),
      onAudioOut: (bytes) => audioOut.push(bytes),
    });
    expect(tts.fake.synthesized).toEqual(["Ciao mondo."]);
    expect(audioOut.length).toBe(1);
    expect(audioOut[0]?.[0]).toBe(1);
  });

  test("#given multiple clause-boundaries in one session reply #when the loop runs #then TTS is called once per boundary and the audio is forwarded in order", async () => {
    const stt = makeFakeStt([{ kind: "final", text: "fai due cose", t_ms: 5 }]);
    const session = makeFakeSession([
      [
        { kind: "clause-boundary", text: "Prima frase.", t_ms: 10 },
        { kind: "clause-boundary", text: " Seconda frase.", t_ms: 20 },
        { kind: "session-idle", t_ms: 30 },
      ],
    ]);
    const tts = makeFakeTts([new Uint8Array([10])]);
    const audioOut: Uint8Array[] = [];
    await runVoiceLoop({
      stt,
      session,
      tts,
      mic: fromArray([chunk([1])]),
      onAudioOut: (bytes) => audioOut.push(bytes),
    });
    expect(tts.fake.synthesized).toEqual(["Prima frase.", " Seconda frase."]);
    expect(audioOut.length).toBe(2);
  });

  test("#given two consecutive final transcripts #when the loop runs #then two prompts are sent and the loop closes cleanly", async () => {
    const stt = makeFakeStt([
      { kind: "final", text: "primo prompt", t_ms: 10 },
      { kind: "final", text: "secondo prompt", t_ms: 50 },
    ]);
    const session = makeFakeSession([
      [{ kind: "session-idle", t_ms: 20 }],
      [{ kind: "session-idle", t_ms: 60 }],
    ]);
    const tts = makeFakeTts([]);
    await runVoiceLoop({
      stt,
      session,
      tts,
      mic: fromArray([chunk([1])]),
      onAudioOut: () => {},
    });
    expect(session._fake.promptsSent).toEqual([
      "primo prompt",
      "secondo prompt",
    ]);
  });

  test("#given partial STT events but no final #when the loop runs #then session.sendPrompt is not called", async () => {
    const stt = makeFakeStt([
      { kind: "partial", text: "ciao", t_ms: 10 },
      { kind: "partial", text: "ciao mondo", t_ms: 15 },
    ]);
    const session = makeFakeSession([]);
    const tts = makeFakeTts([]);
    await runVoiceLoop({
      stt,
      session,
      tts,
      mic: fromArray([chunk([1])]),
      onAudioOut: () => {},
    });
    expect(session._fake.promptsSent.length).toBe(0);
  });

  test("#given AbortSignal aborted before start #when the loop runs #then it throws AbortError without sending any prompts", async () => {
    const stt = makeFakeStt([{ kind: "final", text: "ciao", t_ms: 10 }]);
    const session = makeFakeSession([[{ kind: "session-idle", t_ms: 20 }]]);
    const tts = makeFakeTts([]);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      runVoiceLoop({
        stt,
        session,
        tts,
        mic: fromArray([chunk([1])]),
        onAudioOut: () => {},
        signal: ctrl.signal,
      }),
    ).rejects.toThrow(/AbortError/);
    expect(session._fake.promptsSent.length).toBe(0);
  });
});
