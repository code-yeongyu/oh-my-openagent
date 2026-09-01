import { describe, expect, it } from "bun:test";
import { AST_GREP_MCP_NAME, handleAstGrepMcpRequest } from "./index";

describe("ast-grep-mcp smoke", () => {
  it("#given an initialize request #when handled through the package entry #then the handshake identifies ast_grep and echoes the protocol", async () => {
    const protocolVersion = "2025-06-18";

    const response = await handleAstGrepMcpRequest({
      jsonrpc: "2.0",
      id: "smoke",
      method: "initialize",
      params: { protocolVersion },
    });

    expect(response?.result?.serverInfo).toMatchObject({ name: AST_GREP_MCP_NAME });
    expect(response?.result?.protocolVersion).toBe(protocolVersion);
  });
});
