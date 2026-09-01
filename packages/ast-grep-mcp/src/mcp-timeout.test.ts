import { describe, expect, it, jest } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { runMcpStdioServer } from "./mcp";

describe("ast_grep MCP hung-call abort", () => {
  it("#given a hung tool call #when the parent process disappears #then the active sg call is aborted", async () => {
    jest.useFakeTimers();
    try {
      // given: subscribe to the exact abort event before exposing the in-flight call
      const capture = captureStdout();
      const input = new PassThrough();
      const started = Promise.withResolvers<AbortSignal>();
      const aborted = Promise.withResolvers<string>();

      const server = runMcpStdioServer(input, capture.stdout, {
        resolveSgPath: () => "/stub/sg",
        parentWatchdog: { parentPid: 4242, pollIntervalMs: 1_000, probeAlive: () => false },
        executors: {
          search: async (_input, _sgPath, signal) => {
            const activeSignal = signal as AbortSignal;
            const termination = new Promise<void>((resolve) => {
              activeSignal.addEventListener("abort", () => {
                aborted.resolve(String(activeSignal.reason ?? "aborted"));
                resolve();
              }, { once: true });
            });
            started.resolve(activeSignal);
            await termination;
            return { schemaVersion: 1, ok: false, kind: "search", error: { code: "ABORTED", message: "aborted" } } as never;
          },
        },
      });
      input.write('{"jsonrpc":"2.0","id":"hang","method":"tools/call","params":{"name":"search","arguments":{"pattern":"foo($$$ARGS)","language":"typescript","paths":["src"]}}}\n');
      const signal = await withTimeout(started.promise, "tool call start");
      expect(signal.aborted).toBe(false);

      const abortOutcome = withTimeout(aborted.promise, "active call abort");
      const serverOutcome = withTimeout(server, "server termination");

      // when: deterministically fire the already-subscribed watchdog tick
      jest.advanceTimersByTime(1_000);

      // then: the exact abort event resolves before the bounded deadline; after
      // that event, advancing to the deadline proves server termination is bounded
      expect(signal.aborted).toBe(true);
      expect(await abortOutcome).toContain("parent process exited");
      jest.advanceTimersByTime(1_000);
      await serverOutcome;
    } finally {
      jest.useRealTimers();
    }
  });

  it("#given a completed call #when a later call starts #then it receives a fresh, unaborted signal", async () => {
    // given
    const capture = captureStdout();
    const input = new PassThrough();
    const signals: AbortSignal[] = [];

    const server = runMcpStdioServer(input, capture.stdout, {
      resolveSgPath: () => "/stub/sg",
      executors: {
        search: async (_input, _sgPath, signal) => {
          signals.push(signal as AbortSignal);
          return { schemaVersion: 1, ok: true, kind: "search" } as never;
        },
      },
    });

    // when
    input.write('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"pattern":"foo($$$ARGS)","language":"typescript","paths":["src"]}}}\n');
    input.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"pattern":"foo($$$ARGS)","language":"typescript","paths":["src"]}}}\n');
    input.end();
    await server;

    // then
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });
});

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 2_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error: unknown) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function captureStdout(): { readonly stdout: Writable; readonly read: () => string } {
  let captured = "";
  const stdout = new Writable({
    write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      captured += chunk instanceof Buffer ? chunk.toString() : String(chunk);
      callback();
    },
  });
  return { stdout, read: () => captured };
}
