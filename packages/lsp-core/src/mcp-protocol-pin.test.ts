import { describe, expect, it } from "bun:test";
import { Readable, Writable } from "node:stream";
import { handleLspMcpRequest, runMcpStdioServer } from "./mcp";

describe("lsp MCP protocol pins", () => {
  it("#given initialize request #when handled #then exact server info and capabilities stay stable", async () => {
    const response = await handleLspMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "todo-23", version: "0.0.0" } },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "lsp", version: "0.1.0" },
        protocolVersion: "2024-11-05",
      },
    });
  });

  it("#given malformed stdio line #when read #then parse error envelope includes parser data", async () => {
    const out: string[] = [];

    await runMcpStdioServer(Readable.from(["garbage\n"]), collectingWritable(out));

    const response = JSON.parse(out.join(""));
    if (!isProtocolErrorResponse(response)) {
      throw new TypeError(`Expected protocol error response: ${out.join("")}`);
    }

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
        data: response.error.data,
      },
    });
    expect(typeof response.error.data).toBe("string");
    expect(response.error.data).toContain("garbage");
  });
});

function collectingWritable(chunks: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback): void {
      chunks.push(chunk.toString());
      callback();
    },
  });
}

function isProtocolErrorResponse(value: unknown): value is {
  readonly jsonrpc: string;
  readonly id: null;
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value;
  if (!("error" in record)) return false;
  const { error } = record;
  return typeof error === "object" && error !== null && !Array.isArray(error);
}
