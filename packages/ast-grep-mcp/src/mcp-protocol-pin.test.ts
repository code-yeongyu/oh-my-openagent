import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { AST_GREP_MCP_TOOLS, handleAstGrepMcpRequest, runMcpStdioServer } from "./mcp";

describe("ast_grep MCP protocol pins", () => {
  it("#given initialize request #when handled #then exact server info and capabilities stay stable", async () => {
    // given / when
    const response = await handleAstGrepMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "todo-8", version: "0.0.0" } },
    });

    // then
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ast_grep", version: "0.1.0" },
        protocolVersion: "2024-11-05",
      },
    });
  });

  it("#given initialize without protocolVersion #when handled #then it falls back to 2024-11-05", async () => {
    const response = await handleAstGrepMcpRequest({ jsonrpc: "2.0", id: "init", method: "initialize", params: {} });
    expect(response?.result?.protocolVersion).toBe("2024-11-05");
  });

  it("#given initialize with a newer protocolVersion #when handled #then the requested version is echoed", async () => {
    const response = await handleAstGrepMcpRequest({
      jsonrpc: "2.0",
      id: "init",
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(response?.result?.protocolVersion).toBe("2025-06-18");
  });

  it("#given tools/list #when handled #then exactly the raw search/rewrite/scan names are returned", async () => {
    // given / when
    const response = await handleAstGrepMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });

    // then
    const tools = response?.result?.tools ?? [];
    expect(tools.map((tool) => tool.name)).toEqual(["search", "rewrite", "scan"]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(Array.isArray(schema.required)).toBe(true);
    }
    expect(AST_GREP_MCP_TOOLS.map((tool) => tool.name)).toEqual(["search", "rewrite", "scan"]);
  });

  it("#given ping #when handled #then an empty result is returned", async () => {
    const response = await handleAstGrepMcpRequest({ jsonrpc: "2.0", id: 3, method: "ping" });
    expect(response).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });

  it("#given notifications/initialized #when handled #then no response is produced", async () => {
    const response = await handleAstGrepMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response).toBeUndefined();
  });

  it("#given a non-object request #when handled #then -32600 Invalid Request", async () => {
    expect(await handleAstGrepMcpRequest("not-an-object")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
    expect(await handleAstGrepMcpRequest(["array"])).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("#given an unknown method #when handled #then -32601 Method not found", async () => {
    const response = await handleAstGrepMcpRequest({ jsonrpc: "2.0", id: 9, method: "resources/list" });
    expect(response?.error?.code).toBe(-32601);
    expect(response?.error?.message).toContain("resources/list");
  });

  it("#given tools/call without params.name #when handled #then -32602 Invalid params", async () => {
    const missingName = await handleAstGrepMcpRequest({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { arguments: {} } });
    expect(missingName).toEqual({
      jsonrpc: "2.0",
      id: 10,
      error: { code: -32602, message: "tools/call requires params.name" },
    });

    const missingParams = await handleAstGrepMcpRequest({ jsonrpc: "2.0", id: 11, method: "tools/call" });
    expect(missingParams?.error?.code).toBe(-32602);
  });

  it("#given a malformed stdio line #when the server parses it #then the JSON-RPC parse error envelope is written", async () => {
    // given
    const input = new PassThrough();
    const output = new PassThrough();
    const received = nextOutput(output);

    // when
    const server = runMcpStdioServer(input, output, { resolveSgPath: () => "/stub/sg" });
    input.end("garbage\n");

    // then
    const parsed = JSON.parse(await received) as { id: unknown; error: { code: number } };
    expect(parsed.id).toBeNull();
    expect(parsed.error.code).toBe(-32700);
    await server;
  });
});

function nextOutput(output: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    output.once("data", (chunk: Buffer | string) => {
      resolve(String(chunk));
    });
  });
}
