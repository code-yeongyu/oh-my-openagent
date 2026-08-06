import { describe, expect, it } from "bun:test";
import { AST_GREP_ERROR_CODES, handleAstGrepMcpRequest, type AstGrepMcpOptions } from "./mcp";

const SG_PATH = "/stub/sg";

function stubOptions(overrides: Partial<AstGrepMcpOptions> = {}): AstGrepMcpOptions {
  return { resolveSgPath: () => SG_PATH, ...overrides };
}

function payloadOf(response: Awaited<ReturnType<typeof handleAstGrepMcpRequest>>): Record<string, unknown> {
  const content = response?.result?.content ?? [];
  const first = content[0];
  if (first === undefined) throw new Error("response carried no content");
  return JSON.parse(first.text) as Record<string, unknown>;
}

const VALID_SEARCH_ARGS = { pattern: "foo($$$ARGS)", language: "typescript", paths: ["src"] } as const;

describe("ast_grep MCP tools/call dispatch", () => {
  it("#given a known tool #when called #then the matching execute function receives coerced args and sgPath", async () => {
    // given
    const seen: Array<{ readonly tool: string; readonly input: unknown; readonly sgPath: string }> = [];
    const options = stubOptions({
      executors: {
        search: async (input, sgPath) => {
          seen.push({ tool: "search", input, sgPath });
          return { schemaVersion: 1, ok: true, kind: "search" } as never;
        },
        rewrite: async (input, sgPath) => {
          seen.push({ tool: "rewrite", input, sgPath });
          return { schemaVersion: 1, ok: true, kind: "rewrite" } as never;
        },
        scan: async (input, sgPath) => {
          seen.push({ tool: "scan", input, sgPath });
          return { schemaVersion: 1, ok: true, kind: "scan" } as never;
        },
      },
    });

    // when
    const argsFor = { search: VALID_SEARCH_ARGS, rewrite: { pattern: "$A" }, scan: { pattern: "$A" } } as const;
    for (const name of ["search", "rewrite", "scan"] as const) {
      const response = await handleAstGrepMcpRequest(
        { jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: argsFor[name] } },
        options,
      );
      // then
      expect(response?.result?.isError).toBe(false);
      expect(payloadOf(response).kind).toBe(name);
    }

    expect(seen.map((entry) => entry.tool)).toEqual(["search", "rewrite", "scan"]);
    for (const entry of seen) expect(entry.sgPath).toBe(SG_PATH);
    // rewrite and scan parse internally, so the MCP layer forwards their raw arguments.
    expect(seen[1]?.input).toEqual({ pattern: "$A" });
    expect(seen[2]?.input).toEqual({ pattern: "$A" });
    // search has no internal parse, so the MCP layer parses first and forwards the
    // normalized input (defaults filled in) — never the raw object.
    expect(seen[0]?.input).toMatchObject({
      pattern: "foo($$$ARGS)",
      language: "typescript",
      paths: ["src"],
      strictness: "smart",
      maxMatches: 50,
      timeoutMs: 300000,
    });
  });

  it("#given tools/call with omitted arguments #when dispatched to a self-parsing tool #then the executor receives an empty object", async () => {
    let received: unknown = "unset";
    const response = await handleAstGrepMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "scan" } },
      stubOptions({
        executors: {
          scan: async (input) => {
            received = input;
            return { schemaVersion: 1, ok: true, kind: "scan" } as never;
          },
        },
      }),
    );

    expect(received).toEqual({});
    expect(response?.result?.isError).toBe(false);
  });

  it("#given search tools/call with EMPTY arguments #when dispatched #then INVALID_ARGUMENT preflight, never an internal TypeError", async () => {
    // Regression: {} used to reach executeSearch unparsed and surface the internal
    // "Cannot read properties of undefined (reading 'trim')" TypeError as SG_FAILED.
    let executed = false;
    const response = await handleAstGrepMcpRequest(
      { jsonrpc: "2.0", id: "empty", method: "tools/call", params: { name: "search", arguments: {} } },
      stubOptions({
        executors: {
          search: async () => {
            executed = true;
            return { schemaVersion: 1, ok: true, kind: "search" } as never;
          },
        },
      }),
    );

    expect(executed).toBe(false);
    expect(response?.error).toBeUndefined();
    expect(response?.result?.isError).toBe(true);
    const payload = payloadOf(response) as { ok: boolean; error: { code: string; message: string; phase: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("INVALID_ARGUMENT");
    expect(payload.error.phase).toBe("preflight");
    expect(payload.error.message).toContain("pattern");
    expect(payload.error.message).not.toContain("Cannot read properties");
  });

  it("#given search tools/call with an UNKNOWN property #when dispatched #then additionalProperties:false is enforced", async () => {
    // Regression: {valid args + unknown:true} used to return isError:false because the
    // MCP layer never ran searchInputSchema.parse.
    let executed = false;
    const response = await handleAstGrepMcpRequest(
      {
        jsonrpc: "2.0",
        id: "unknown-prop",
        method: "tools/call",
        params: { name: "search", arguments: { ...VALID_SEARCH_ARGS, unknown: true } },
      },
      stubOptions({
        executors: {
          search: async () => {
            executed = true;
            return { schemaVersion: 1, ok: true, kind: "search" } as never;
          },
        },
      }),
    );

    expect(executed).toBe(false);
    expect(response?.result?.isError).toBe(true);
    const payload = payloadOf(response) as { error: { code: string; message: string; language: string } };
    expect(payload.error.code).toBe("INVALID_ARGUMENT");
    expect(payload.error.message).toContain("unknown");
    expect(payload.error.language).toBe("typescript");
  });

  it("#given search arguments over the 16 KiB BYTE pattern budget #when dispatched #then INVALID_ARGUMENT preflight", async () => {
    const response = await handleAstGrepMcpRequest(
      {
        jsonrpc: "2.0",
        id: "oversize",
        method: "tools/call",
        params: { name: "search", arguments: { ...VALID_SEARCH_ARGS, pattern: "a".repeat(16 * 1024 + 1) } },
      },
      stubOptions(),
    );

    expect(response?.result?.isError).toBe(true);
    const payload = payloadOf(response) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("INVALID_ARGUMENT");
    expect(payload.error.message).toContain("16384 bytes");
  });

  it("#given an unknown tool name #when called #then a domain INVALID_ARGUMENT isError payload (not a JSON-RPC error)", async () => {
    // given / when
    const response = await handleAstGrepMcpRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "mcp__ast_grep__search", arguments: {} } },
      stubOptions(),
    );

    // then
    expect(response?.error).toBeUndefined();
    expect(response?.result?.isError).toBe(true);
    const payload = payloadOf(response) as { ok: boolean; error: { code: string; message: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("INVALID_ARGUMENT");
    expect(payload.error.message).toContain("mcp__ast_grep__search");
  });

  it("#given a tool payload with ok:false #when returned #then isError is true and the taxonomy code survives", async () => {
    const response = await handleAstGrepMcpRequest(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "scan", arguments: {} } },
      stubOptions({
        executors: {
          scan: async () =>
            ({
              schemaVersion: 1,
              ok: false,
              kind: "scan",
              error: { code: "RULE_PARSE_FAILED", message: "bad yaml", retryable: false, phase: "preview", details: {} },
              durationMs: 3,
            }) as never,
        },
      }),
    );

    expect(response?.result?.isError).toBe(true);
    const payload = payloadOf(response) as { error: { code: string } };
    expect(payload.error.code).toBe("RULE_PARSE_FAILED");
  });

  it("#given an executor that throws #when dispatched #then the throw becomes an SG_FAILED isError payload", async () => {
    const response = await handleAstGrepMcpRequest(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "search", arguments: VALID_SEARCH_ARGS } },
      stubOptions({
        executors: {
          search: async () => {
            throw new Error("stub blew up");
          },
        },
      }),
    );

    expect(response?.error).toBeUndefined();
    expect(response?.result?.isError).toBe(true);
    const payload = payloadOf(response) as { ok: boolean; error: { code: string; message: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("SG_FAILED");
    expect(payload.error.message).toContain("stub blew up");
  });

  it("#given no resolvable sg binary #when a tool is called #then BINARY_NOT_FOUND isError with install hints", async () => {
    const response = await handleAstGrepMcpRequest(
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "search", arguments: {} } },
      {
        resolveSgPath: () => {
          throw Object.assign(new Error("ast-grep binary not found"), { hints: ["brew install ast-grep"] });
        },
      },
    );

    expect(response?.result?.isError).toBe(true);
    const payload = payloadOf(response) as { error: { code: string } };
    expect(payload.error.code).toBe("BINARY_NOT_FOUND");
  });

  it("#given the shipped taxonomy #when inspected #then it holds the 19 documented codes", () => {
    expect(AST_GREP_ERROR_CODES).toContain("RULE_PARSE_FAILED");
    expect(AST_GREP_ERROR_CODES).toContain("BINARY_NOT_FOUND");
    expect(new Set(AST_GREP_ERROR_CODES).size).toBe(19);
  });
});
