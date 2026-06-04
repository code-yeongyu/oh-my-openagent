import { describe, expect, it } from "bun:test";
import { Readable, Writable } from "node:stream";
import { runMcpStdioServer } from "./mcp";

describe("git_bash MCP startup gate", () => {
  it("#given non-Windows host #when stdio server starts #then it exits without protocol noise", async () => {
    // given
    const capture = captureStdout();

    // when
    await runMcpStdioServer(Readable.from(['{"jsonrpc":"2.0","id":"init","method":"initialize"}\n']), capture.stdout, {
      platform: "darwin",
      env: {},
      exists: () => false,
      where: () => [],
    });

    // then
    expect(capture.read()).toBe("");
  });

  it("#given Windows host without Git Bash #when stdio server starts #then it exits without protocol noise", async () => {
    // given
    const capture = captureStdout();

    // when
    await runMcpStdioServer(Readable.from(['{"jsonrpc":"2.0","id":"init","method":"initialize"}\n']), capture.stdout, {
      platform: "win32",
      env: {},
      exists: () => false,
      where: () => [],
    });

    // then
    expect(capture.read()).toBe("");
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
