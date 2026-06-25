import { describe, expect, test } from "bun:test";
import { DeepgramSttAdapter } from "./adapter.ts";

type Handler = (data: unknown) => void;

interface FakeConn {
  messageHandlers: Handler[];
  closeHandlers: Handler[];
  errorHandlers: Handler[];
  mediaChunks: ArrayBuffer[];
  finalized: boolean;
  closed: boolean;
  opened: boolean;
}

function makeFakeFactory(opts: { connectThrows?: boolean } = {}) {
  const conn: FakeConn = {
    messageHandlers: [],
    closeHandlers: [],
    errorHandlers: [],
    mediaChunks: [],
    finalized: false,
    closed: false,
    opened: false,
  };
  const connection = {
    on: (event: string, handler: Handler) => {
      if (event === "message") conn.messageHandlers.push(handler);
      if (event === "close") conn.closeHandlers.push(handler);
      if (event === "error") conn.errorHandlers.push(handler);
    },
    connect: () => {
      conn.opened = true;
    },
    waitForOpen: async () => {},
    sendMedia: (chunk: ArrayBuffer) => {
      conn.mediaChunks.push(chunk);
    },
    sendFinalize: () => {
      conn.finalized = true;
    },
    close: () => {
      conn.closed = true;
    },
  };
  const factory = () => ({
    listen: {
      v1: {
        connect: async () => {
          if (opts.connectThrows) throw new Error("network unreachable");
          return connection;
        },
      },
    },
  });
  return { factory, conn, connection };
}

function chunk(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

describe("DeepgramSttAdapter streamLive", () => {
  test("#given live frames flow #when a final result is emitted #then yields a final SttEvent and the connection receives the frames", async () => {
    const { factory, conn, connection } = makeFakeFactory();
    const adapter = new DeepgramSttAdapter(
      { apiKey: "k", model: "nova-3", language: "multi" },
      factory,
    );
    const frames = fromArray([chunk([1, 2]), chunk([3, 4])]);
    const iter = adapter.streamLive(frames);
    const consumer = (async () => {
      const events = [];
      for await (const ev of iter) {
        events.push(ev);
        if (ev.kind === "final") break;
      }
      return events;
    })();
    while (conn.mediaChunks.length < 2 || !conn.opened) {
      await new Promise((r) => setTimeout(r, 5));
    }
    for (const handler of conn.messageHandlers) {
      handler({
        type: "Results",
        is_final: true,
        channel: { alternatives: [{ transcript: "ciao mondo" }] },
      });
    }
    const events = await consumer;
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe("final");
    expect(events[0]?.text).toBe("ciao mondo");
    expect(conn.mediaChunks.length).toBe(2);
    void connection;
  });

  test("#given a partial then a final #when consumed #then yields both events in order", async () => {
    const { factory, conn } = makeFakeFactory();
    const adapter = new DeepgramSttAdapter({ apiKey: "k" }, factory);
    const iter = adapter.streamLive(fromArray([chunk([1])]));
    const consumer = (async () => {
      const events = [];
      for await (const ev of iter) {
        events.push(ev);
        if (ev.kind === "final") break;
      }
      return events;
    })();
    while (!conn.opened) await new Promise((r) => setTimeout(r, 5));
    for (const handler of conn.messageHandlers) {
      handler({
        type: "Results",
        is_final: false,
        channel: { alternatives: [{ transcript: "ciao" }] },
      });
      handler({
        type: "Results",
        is_final: true,
        channel: { alternatives: [{ transcript: "ciao mondo" }] },
      });
    }
    const events = await consumer;
    expect(events.map((e) => e.kind)).toEqual(["partial", "final"]);
  });

  test("#given factory connect throws #when streamLive consumed #then it rejects with a clear connect error", async () => {
    const { factory } = makeFakeFactory({ connectThrows: true });
    const adapter = new DeepgramSttAdapter({ apiKey: "k" }, factory);
    const iter = adapter.streamLive(fromArray([chunk([1])]));
    await expect(
      (async () => {
        for await (const _ of iter) {
          void _;
        }
      })(),
    ).rejects.toThrow(/deepgram connect failed/);
  });

  test("#given the frames source completes #when consumed #then sendFinalize is called on the connection", async () => {
    const { factory, conn } = makeFakeFactory();
    const adapter = new DeepgramSttAdapter({ apiKey: "k" }, factory);
    const iter = adapter.streamLive(fromArray([chunk([1])]));
    const consumer = (async () => {
      for await (const _ of iter) {
        for (const handler of conn.closeHandlers) handler(undefined);
        return;
      }
    })();
    while (!conn.opened) await new Promise((r) => setTimeout(r, 5));
    while (!conn.finalized) await new Promise((r) => setTimeout(r, 5));
    for (const handler of conn.messageHandlers) {
      handler({
        type: "Results",
        is_final: true,
        channel: { alternatives: [{ transcript: "ok" }] },
      });
    }
    await consumer;
    expect(conn.finalized).toBe(true);
  });

  test("#given AbortSignal aborted before consumption #when streamLive runs #then it throws an AbortError on first event read", async () => {
    const { factory } = makeFakeFactory();
    const adapter = new DeepgramSttAdapter({ apiKey: "k" }, factory);
    const ctrl = new AbortController();
    ctrl.abort();
    const iter = adapter.streamLive(fromArray([chunk([1])]), {
      signal: ctrl.signal,
    });
    await expect(
      (async () => {
        for await (const _ of iter) {
          void _;
        }
      })(),
    ).rejects.toThrow(/AbortError/);
  });
});
