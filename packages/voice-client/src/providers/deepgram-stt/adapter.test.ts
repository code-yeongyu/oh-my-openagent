import { afterEach, describe, expect, test } from "bun:test";
import type { AudioSample, SttEvent } from "../../harness/types";
import { DeepgramSttAdapter } from "./adapter";
import type { DeepgramSttConfig } from "./types";

type DeepgramResult = {
  type: "Results";
  is_final: boolean;
  channel: { alternatives: [{ transcript: string }] };
};

type CapturedParams = {
  model?: string;
  language?: string;
  endpointing?: number;
  sample_rate?: number;
  encoding?: string;
  interim_results?: string;
  punctuate?: string;
};

type MessageHandler = (data: DeepgramResult) => void;
type CloseHandler = () => void;
type ErrorHandler = (error: Error) => void;

type FakeConnection = {
  closeCalls: number;
  finalized: boolean;
  mediaChunks: Array<ArrayBuffer>;
  on(event: "message", handler: MessageHandler): void;
  on(event: "close", handler: CloseHandler): void;
  on(event: "error", handler: ErrorHandler): void;
  connect(): void;
  waitForOpen(): Promise<void>;
  sendMedia(chunk: ArrayBuffer): void;
  sendFinalize(message?: { type: "Finalize" }): void;
  close(): void;
};

type FakeFactory = (apiKey: string) => {
  listen: { v1: { connect(params: CapturedParams): Promise<FakeConnection> } };
};

const tmpFiles: string[] = [];

async function writeSampleFile(name: string): Promise<AudioSample> {
  const path = `/tmp/deepgram-stt-${Date.now()}-${name}.wav`;
  await Bun.write(path, new Uint8Array([1, 2, 3, 4]));
  tmpFiles.push(path);
  return { id: name, lang: "it-en-mixed", wavPath: path };
}

function result(text: string, isFinal: boolean): DeepgramResult {
  return {
    type: "Results",
    is_final: isFinal,
    channel: { alternatives: [{ transcript: text }] },
  };
}

function createConnection(messages: DeepgramResult[]): FakeConnection {
  const messageHandlers: MessageHandler[] = [];
  const closeHandlers: CloseHandler[] = [];
  const errorHandlers: ErrorHandler[] = [];

  return {
    closeCalls: 0,
    finalized: false,
    mediaChunks: [],
    on(event, handler) {
      if (event === "message") messageHandlers.push(handler);
      if (event === "close") closeHandlers.push(handler);
      if (event === "error") errorHandlers.push(handler);
    },
    connect() {},
    async waitForOpen() {},
    sendMedia(chunk) {
      this.mediaChunks.push(chunk);
    },
    sendFinalize() {
      this.finalized = true;
      queueMicrotask(() => {
        for (const message of messages) {
          for (const handler of messageHandlers) handler(message);
        }
        if (!messages.some((message) => message.is_final)) {
          for (const handler of closeHandlers) handler();
        }
      });
    },
    close() {
      this.closeCalls += 1;
      for (const handler of closeHandlers) handler();
    },
  };
}

function createAdapter(
  config: DeepgramSttConfig,
  connection: FakeConnection,
  capture?: (params: CapturedParams) => void,
): DeepgramSttAdapter {
  const factory: FakeFactory = () => ({
    listen: {
      v1: {
        async connect(params) {
          capture?.(params);
          return connection;
        },
      },
    },
  });
  return new DeepgramSttAdapter(config, factory);
}

async function collectEvents(adapter: DeepgramSttAdapter, sample: AudioSample): Promise<SttEvent[]> {
  const events: SttEvent[] = [];
  for await (const event of adapter.transcribe(sample)) {
    events.push(event);
  }
  return events;
}

afterEach(async () => {
  for (const path of tmpFiles.splice(0)) {
    await Bun.file(path).delete();
  }
});

describe("DeepgramSttAdapter", () => {
  test("#given partial then final Results #when transcribe runs #then yields matching partial and final events", async () => {
    const connection = createConnection([result("ciao", false), result("ciao world", true)]);
    const adapter = createAdapter({ apiKey: "test" }, connection);
    const sample = await writeSampleFile("partial-final");

    const events = await collectEvents(adapter, sample);

    expect(events).toEqual([
      { kind: "partial", text: "ciao", t_ms: expect.any(Number) },
      { kind: "final", text: "ciao world", t_ms: expect.any(Number) },
    ]);
    expect(connection.finalized).toBe(true);
    expect(connection.mediaChunks).toHaveLength(1);
  });

  test("#given only interim Results then close #when transcribe runs #then yields partials and ends", async () => {
    const connection = createConnection([result("uno", false), result("uno two", false)]);
    const adapter = createAdapter({ apiKey: "test" }, connection);
    const sample = await writeSampleFile("interim-close");

    const events = await collectEvents(adapter, sample);

    expect(events.map((event) => event.text)).toEqual(["uno", "uno two"]);
    expect(events.every((event) => event.kind === "partial")).toBe(true);
  });

  test("#given connect throws #when transcribe runs #then iterable rejects with clear connect error", async () => {
    const factory: FakeFactory = () => ({
      listen: {
        v1: {
          async connect() {
            throw new Error("socket denied");
          },
        },
      },
    });
    const adapter = new DeepgramSttAdapter({ apiKey: "test" }, factory);
    const sample = await writeSampleFile("connect-fails");

    await expect(collectEvents(adapter, sample)).rejects.toThrow("deepgram connect failed: socket denied");
  });

  test("#given multilingual nova config #when adapter connects #then params are passed verbatim", async () => {
    const connection = createConnection([result("ciao", true)]);
    let captured: CapturedParams | undefined;
    const adapter = createAdapter(
      { apiKey: "test", language: "multi", model: "nova-3", endpointingMs: 100 },
      connection,
      (params) => {
        captured = params;
      },
    );
    const sample = await writeSampleFile("params");

    await collectEvents(adapter, sample);

    expect(captured).toMatchObject({
      model: "nova-3",
      language: "multi",
      endpointing: 100,
    });
  });

  test("#given word-level language tags #when transcribe runs #then final text preserves mixed language chunks", async () => {
    const mixed = result("ciao world", true);
    const connection = createConnection([mixed]);
    const adapter = createAdapter({ apiKey: "test", language: "multi" }, connection);
    const sample = await writeSampleFile("mixed-language");

    const events = await collectEvents(adapter, sample);

    expect(events).toEqual([{ kind: "final", text: "ciao world", t_ms: expect.any(Number) }]);
  });

  test("#given consumer cancels iteration #when iterator returns early #then connection closes cleanly", async () => {
    const connection = createConnection([result("ciao", false)]);
    const adapter = createAdapter({ apiKey: "test" }, connection);
    const sample = await writeSampleFile("cancel");
    const iterator = adapter.transcribe(sample)[Symbol.asyncIterator]();

    const first = await iterator.next();
    await iterator.return?.();

    expect(first.value).toMatchObject({ kind: "partial", text: "ciao" });
    expect(connection.closeCalls).toBe(1);
  });
});
