import { describe, expect, test } from "bun:test";
import { CartesiaTtsAdapter, type CartesiaTtsClientFactory } from "./adapter";
import { detectClauseBoundary } from "./clause-detector";
import type { CartesiaTtsConfig } from "./types";
import type { TtsEvent } from "../../harness/types";

interface FakeSendPayload {
  modelId: string;
  voice: { mode: "id"; id: string };
  transcript: string;
  contextId: string;
  language: "it" | "en";
}

interface FakeSocketParams {
  container: "raw" | "mp3" | "wav";
  encoding: "pcm_f32le" | "pcm_s16le";
  sampleRate: number;
}

class FakeWs {
  readonly sent: FakeSendPayload[] = [];
  readonly socketParams: FakeSocketParams[] = [];
  readonly cancelled: string[] = [];

  constructor(private readonly chunks: Uint8Array[] = [new Uint8Array([1, 2, 3])]) {}

  async send(payload: FakeSendPayload): Promise<AsyncIterable<Uint8Array>> {
    this.sent.push(payload);
    return this.streamChunks();
  }

  async continue(payload: FakeSendPayload): Promise<AsyncIterable<Uint8Array>> {
    this.sent.push(payload);
    return this.streamChunks();
  }

  async cancel(input: { contextId: string }): Promise<void> {
    this.cancelled.push(input.contextId);
  }

  disconnect(): void {}

  private async *streamChunks(): AsyncIterable<Uint8Array> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

class HangingWs extends FakeWs {
  override async send(payload: FakeSendPayload): Promise<AsyncIterable<Uint8Array>> {
    this.sent.push(payload);
    return this.hangingStream();
  }

  private async *hangingStream(): AsyncIterable<Uint8Array> {
    yield new Uint8Array([9]);
    await new Promise(() => undefined);
  }
}

function createFactory(ws: FakeWs): CartesiaTtsClientFactory {
  return () => ({
    tts: {
      websocket: async (params: FakeSocketParams) => {
        ws.socketParams.push(params);
        return ws;
      },
    },
  });
}

async function collect(iterable: AsyncIterable<TtsEvent>): Promise<TtsEvent[]> {
  const events: TtsEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

async function* chunks(...values: string[]): AsyncIterable<string> {
  for (const value of values) {
    yield value;
  }
}

function config(overrides: Partial<CartesiaTtsConfig> = {}): CartesiaTtsConfig {
  return { apiKey: "key", voice: "someVoiceId", ...overrides };
}

describe("CartesiaTtsAdapter", () => {
  test("#given short text and one audio chunk #when synthesize runs #then yields first_byte then audio_chunk", async () => {
    // given
    const ws = new FakeWs([new Uint8Array([1, 2])]);
    const adapter = new CartesiaTtsAdapter(config(), createFactory(ws));

    // when
    const events = await collect(adapter.synthesize("Ciao mondo."));

    // then
    expect(events.map((event) => event.kind)).toEqual(["first_byte", "audio_chunk"]);
    expect(events[1]).toMatchObject({ kind: "audio_chunk", bytes: new Uint8Array([1, 2]) });
  });

  test("#given Italian config #when ws.send runs #then captures request params verbatim", async () => {
    // given
    const ws = new FakeWs();
    const adapter = new CartesiaTtsAdapter(config({ language: "it", voice: "someVoiceId" }), createFactory(ws));

    // when
    await collect(adapter.synthesize("Ciao mondo."));

    // then
    expect(ws.socketParams[0]).toEqual({ container: "raw", encoding: "pcm_f32le", sampleRate: 44100 });
    expect(ws.sent[0]).toMatchObject({ language: "it", transcript: "Ciao mondo.", voice: { mode: "id", id: "someVoiceId" } });
  });

  test("#given connect throws #when synthesize runs #then iterable rejects with clear error", async () => {
    // given
    const adapter = new CartesiaTtsAdapter(config(), () => ({
      tts: {
        websocket: async () => {
          throw new Error("boom");
        },
      },
    }));

    // when
    const result = collect(adapter.synthesize("Ciao mondo."));

    // then
    await expect(result).rejects.toThrow("Cartesia TTS websocket connection failed: boom");
  });

  test("#given streaming chunks complete sentence #when streamSynthesize runs #then sends one clause request", async () => {
    // given
    const ws = new FakeWs();
    const adapter = new CartesiaTtsAdapter(config(), createFactory(ws));

    // when
    await collect(adapter.streamSynthesize(chunks("Ciao ", "mondo.")));

    // then
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]?.transcript).toBe("Ciao mondo.");
  });

  test("#given streaming chunks without punctuation #when upstream closes #then flushes trailing buffer", async () => {
    // given
    const ws = new FakeWs();
    const adapter = new CartesiaTtsAdapter(config(), createFactory(ws));

    // when
    await collect(adapter.streamSynthesize(chunks("Ciao ", "mondo")));

    // then
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]?.transcript).toBe("Ciao mondo");
  });

  test("#given resetContext between calls #when synthesize runs twice #then second call uses new contextId", async () => {
    // given
    const ws = new FakeWs();
    const adapter = new CartesiaTtsAdapter(config(), createFactory(ws));

    // when
    await collect(adapter.synthesize("Ciao."));
    adapter.resetContext();
    await collect(adapter.synthesize("Ancora."));

    // then
    expect(ws.sent[0]?.contextId).toBeString();
    expect(ws.sent[1]?.contextId).toBeString();
    expect(ws.sent[1]?.contextId).not.toBe(ws.sent[0]?.contextId);
  });

  test("#given abort signal mid-stream #when synthesize iterates #then cancels context and terminates", async () => {
    // given
    const ws = new HangingWs();
    const controller = new AbortController();
    const adapter = new CartesiaTtsAdapter(config(), createFactory(ws));
    const iterator = adapter.synthesize("Ciao.", { signal: controller.signal })[Symbol.asyncIterator]();

    // when
    const first = await iterator.next();
    controller.abort();
    const second = await iterator.next();

    // then
    expect(first.value?.kind).toBe("first_byte");
    expect(second.done).toBe(true);
    expect(ws.cancelled).toEqual([ws.sent[0]?.contextId]);
  });

  test("#given detector examples #when detecting boundaries #then returns required indices", () => {
    // given
    const text = "Hello. World";

    // when
    const sentence = detectClauseBoundary(text, "sentence-end");
    const missing = detectClauseBoundary("No boundary yet", "sentence-end");
    const comma = detectClauseBoundary("Pause, here", "comma-pause");

    // then
    expect(sentence).toBe(6);
    expect(missing).toBe(-1);
    expect(comma).toBe(5);
  });
});
