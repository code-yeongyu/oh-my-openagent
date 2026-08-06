import { describe, expect, it } from "bun:test";
import { Readable, Writable } from "node:stream";
import { runMcpStdioServer } from "./mcp";

describe("ast_grep MCP startup", () => {
  it("#given an initialize line on stdin #when the stdio server runs #then it answers with serverInfo ast_grep and no idle timeout", async () => {
    // given
    const capture = captureStdout();
    const lifecycle: Array<{ readonly event: string; readonly data?: unknown }> = [];

    // when
    await runMcpStdioServer(Readable.from(['{"jsonrpc":"2.0","id":"init","method":"initialize"}\n']), capture.stdout, {
      resolveSgPath: () => "/stub/sg",
      lifecycleLog: (event, data) => {
        lifecycle.push({ event, data });
      },
    });

    // then
    expect(capture.read()).toContain('"serverInfo":{"name":"ast_grep"');
    expect(lifecycle).toContainEqual({ event: "stdio_started", data: expect.objectContaining({ idle_timeout_ms: 0 }) });
  });

  it("#given a missing sg binary #when the stdio server starts #then the protocol still answers (resolution is per-call)", async () => {
    // given
    const capture = captureStdout();

    // when
    await runMcpStdioServer(Readable.from(['{"jsonrpc":"2.0","id":"init","method":"tools/list"}\n']), capture.stdout, {
      resolveSgPath: () => {
        throw new Error("ast-grep binary not found");
      },
    });

    // then
    const written = capture.read();
    expect(written).toContain('"name":"search"');
    expect(written).toContain('"name":"rewrite"');
    expect(written).toContain('"name":"scan"');
  });
});

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
