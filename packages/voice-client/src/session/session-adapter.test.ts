import { describe, expect, test } from "bun:test";
import { OpencodeSessionAdapter } from "./session-adapter.ts";
import type {
  OpencodeLikeClient,
  OpencodeRawEvent,
  OpencodeSendMessageRequest,
  SessionEvent,
} from "./types.ts";

interface FakeState {
  capturedMessages: OpencodeSendMessageRequest[];
  eventQueue: OpencodeRawEvent[];
  closed: boolean;
}

function makeFakeClient(
  events: OpencodeRawEvent[] = [],
  opts: { connectThrows?: boolean } = {},
): { client: OpencodeLikeClient; state: FakeState } {
  const state: FakeState = {
    capturedMessages: [],
    eventQueue: [...events],
    closed: false,
  };
  const client: OpencodeLikeClient = {
    async createSession() {
      if (opts.connectThrows) {
        throw new Error("network unreachable");
      }
      return { sessionID: "fake-session-1" };
    },
    async sendMessage(req) {
      state.capturedMessages.push(req);
      return { messageID: "fake-msg-1" };
    },
    async *events() {
      for (const ev of state.eventQueue) {
        if (state.closed) return;
        yield ev;
      }
    },
    close() {
      state.closed = true;
    },
  };
  return { client, state };
}

async function collectEvents(
  adapter: { events(): AsyncIterable<SessionEvent> },
  max = 20,
): Promise<SessionEvent[]> {
  const out: SessionEvent[] = [];
  for await (const ev of adapter.events()) {
    out.push(ev);
    if (out.length >= max) break;
  }
  return out;
}

describe("OpencodeSessionAdapter sendPrompt", () => {
  test("#given config defaults #when sendPrompt is called #then captured parts[0].text carries the voice-intent sentinel prefix", async () => {
    const { client, state } = makeFakeClient();
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096" },
      () => client,
    );
    await adapter.open();
    await adapter.sendPrompt("Ciao Claude");
    expect(state.capturedMessages.length).toBe(1);
    expect(state.capturedMessages[0]?.parts[0]?.text).toBe(
      "[[voice-intent:1]] Ciao Claude",
    );
  });

  test("#given config with voiceIntent set false #when sendPrompt is called #then captured parts[0].text does not carry the sentinel", async () => {
    const { client, state } = makeFakeClient();
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096", voiceIntent: false },
      () => client,
    );
    await adapter.open();
    await adapter.sendPrompt("Ciao Claude");
    expect(state.capturedMessages[0]?.parts[0]?.text).toBe("Ciao Claude");
  });

  test("#given an unopened adapter #when sendPrompt is called #then it throws a session-not-open error", async () => {
    const { client } = makeFakeClient();
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096" },
      () => client,
    );
    await expect(adapter.sendPrompt("hello")).rejects.toThrow(/session not open/);
  });
});

describe("OpencodeSessionAdapter open", () => {
  test("#given createSession throws #when open is called #then it rejects with a clear connect-failed error", async () => {
    const { client } = makeFakeClient([], { connectThrows: true });
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096" },
      () => client,
    );
    await expect(adapter.open()).rejects.toThrow(/opencode connect failed/);
  });

  test("#given createSession succeeds #when open completes #then sessionId is populated", async () => {
    const { client } = makeFakeClient();
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096" },
      () => client,
    );
    await adapter.open();
    expect(adapter.sessionId).toBe("fake-session-1");
  });
});

describe("OpencodeSessionAdapter events translation", () => {
  test("#given an SSE stream emits text deltas that complete two sentences #when events is consumed #then yields four text-delta events plus two clause-boundary events", async () => {
    const events: OpencodeRawEvent[] = [
      { type: "message.part.delta", field: "text", text: "Ciao " },
      { type: "message.part.delta", field: "text", text: "mondo." },
      { type: "message.part.delta", field: "text", text: " Come " },
      { type: "message.part.delta", field: "text", text: "stai?" },
      { type: "session.idle" },
    ];
    const { client } = makeFakeClient(events);
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096" },
      () => client,
    );
    await adapter.open();
    const collected = await collectEvents(adapter);
    const textDeltas = collected.filter((e) => e.kind === "text-delta");
    const clauseBoundaries = collected.filter(
      (e) => e.kind === "clause-boundary",
    );
    expect(textDeltas.length).toBe(4);
    expect(clauseBoundaries.length).toBe(2);
  });

  test("#given an SSE stream emits a tool running then completed update #when events is consumed #then yields a tool-call-started followed by a tool-call-finished with status completed", async () => {
    const events: OpencodeRawEvent[] = [
      {
        type: "message.part.updated",
        part: { type: "tool", name: "Bash", state: { status: "running" } },
      },
      {
        type: "message.part.updated",
        part: { type: "tool", name: "Bash", state: { status: "completed" } },
      },
      { type: "session.idle" },
    ];
    const { client } = makeFakeClient(events);
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096" },
      () => client,
    );
    await adapter.open();
    const collected = await collectEvents(adapter);
    const started = collected.find((e) => e.kind === "tool-call-started");
    const finished = collected.find((e) => e.kind === "tool-call-finished");
    expect(started?.kind).toBe("tool-call-started");
    expect(finished?.kind === "tool-call-finished" ? finished.status : null).toBe(
      "completed",
    );
  });

  test("#given an SSE stream emits session.idle #when events is consumed #then yields session-idle and the iterable completes", async () => {
    const events: OpencodeRawEvent[] = [{ type: "session.idle" }];
    const { client } = makeFakeClient(events);
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096" },
      () => client,
    );
    await adapter.open();
    const collected = await collectEvents(adapter);
    expect(collected.some((e) => e.kind === "session-idle")).toBe(true);
  });

  test("#given an SSE stream emits session.error with a message #when events is consumed #then yields session-error with that message", async () => {
    const events: OpencodeRawEvent[] = [
      { type: "session.error", error: { message: "rate limited" } },
    ];
    const { client } = makeFakeClient(events);
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096" },
      () => client,
    );
    await adapter.open();
    const collected = await collectEvents(adapter);
    const err = collected.find((e) => e.kind === "session-error");
    expect(err?.kind === "session-error" ? err.message : null).toBe(
      "rate limited",
    );
  });

  test("#given an SSE stream emits session.compacting #when events is consumed #then yields session-compacting so downstream T20 can react", async () => {
    const events: OpencodeRawEvent[] = [
      { type: "session.compacting" },
      { type: "session.idle" },
    ];
    const { client } = makeFakeClient(events);
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096" },
      () => client,
    );
    await adapter.open();
    const collected = await collectEvents(adapter);
    expect(collected.some((e) => e.kind === "session-compacting")).toBe(true);
  });

  test("#given close is invoked while a stream is still queued #when consumed afterwards #then the underlying client is closed", async () => {
    const events: OpencodeRawEvent[] = [
      { type: "message.part.delta", field: "text", text: "hello" },
    ];
    const { client, state } = makeFakeClient(events);
    const adapter = new OpencodeSessionAdapter(
      { serverUrl: "http://localhost:4096" },
      () => client,
    );
    await adapter.open();
    adapter.close();
    expect(state.closed).toBe(true);
  });
});
