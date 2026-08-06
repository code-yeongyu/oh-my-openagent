import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { handleGitBashMcpRequest, runMcpStdioServer } from "./mcp";

describe("git_bash MCP protocol pins", () => {
  it("#given initialize request #when handled #then exact server info and capabilities stay stable", async () => {
    const response = await handleGitBashMcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "todo-23", version: "0.0.0" } },
      },
      windowsOptions(),
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "git_bash", version: "0.1.0" },
        protocolVersion: "2024-11-05",
      },
    });
  });

  it("#given malformed stdio line #when parsed #then current method-not-found envelope is preserved", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const received = nextOutput(output);
    const server = runMcpStdioServer(input, output, windowsOptions());

    input.end("garbage\n");

    expect(JSON.parse(await received)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32601, message: "Method not found" },
    });
    await server;
  });
});

function windowsOptions() {
  return {
    platform: "win32",
    env: { OMO_CODEX_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe" },
    exists: (path: string) => path === "C:\\Program Files\\Git\\bin\\bash.exe",
    where: () => [],
  } as const;
}

function nextOutput(output: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    output.once("data", (chunk: Buffer | string) => {
      resolve(String(chunk));
    });
  });
}
