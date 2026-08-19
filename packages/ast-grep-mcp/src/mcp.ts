// mcp.ts — the ast_grep stdio MCP server surface.
//
// Transport and sequential dispatch come from @oh-my-opencode/mcp-stdio-core; this module
// owns only the ast_grep protocol shape: descriptors, lifecycle methods, and tools/call
// dispatch into the tool execute functions.
//
// Fault split (plan todo 8): JSON-RPC errors are reserved for PROTOCOL faults
// (-32600 non-object, -32601 unknown method, -32602 missing params.name). Everything a
// tool can fail at — including an unknown tool name — comes back as a normal successful
// JSON-RPC response whose result carries `isError: true` and the ub §6 taxonomy payload.

import type { Readable, Writable } from "node:stream";
import {
  errorResponse,
  isPlainRecord,
  jsonRpcId,
  runJsonRpcStdioServer,
  successResponse,
  type JsonRpcId,
  type JsonRpcResponse,
  type McpLifecycleLog,
  type McpToolDescriptor,
  type ParentWatchdogConfig,
} from "@oh-my-opencode/mcp-stdio-core";
import { resolveSgBinarySync } from "@oh-my-opencode/utils";
import { executeSearch, searchInputSchema, SEARCH_TOOL_DESCRIPTION, SEARCH_TOOL_NAME, type SearchInput, type SearchPayload } from "./tools/search";
import { executeRewrite, REWRITE_TOOL_DESCRIPTION, REWRITE_TOOL_NAME, type RewritePayload } from "./tools/rewrite";
import { executeScan, SCAN_TOOL_DESCRIPTION, SCAN_TOOL_NAME, type ScanPayload } from "./tools/scan";

export const AST_GREP_SERVER_NAME = "ast_grep" as const;
export const AST_GREP_SERVER_VERSION = "0.1.0" as const;
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

/**
 * The 19-code failure taxonomy: ub §6's 18 codes plus RULE_PARSE_FAILED from the
 * scan tool. Every isError payload this server emits carries one of these codes.
 */
export const AST_GREP_ERROR_CODES = [
  "INVALID_ARGUMENT",
  "BINARY_NOT_FOUND",
  "BINARY_INVALID",
  "UNSUPPORTED_LANGUAGE",
  "PATTERN_HINT_REJECTED",
  "PATTERN_PARSE_FAILED",
  "RULE_PARSE_FAILED",
  "REWRITE_UNBOUND_METAVARIABLE",
  "REWRITE_METAVARIABLE_KIND_MISMATCH",
  "PATH_NOT_FOUND",
  "PATH_UNREADABLE",
  "TIMEOUT",
  "ABORTED",
  "OUTPUT_TOO_LARGE",
  "OUTPUT_PARSE_FAILED",
  "PREVIEW_TRUNCATED",
  "REWRITE_STALE_PREVIEW",
  "SG_FAILED",
  "ENCODING_ERROR",
] as const;

export type AstGrepErrorCode = (typeof AST_GREP_ERROR_CODES)[number];

// ---- tool descriptors ----

const LANGUAGES = [
  "bash", "c", "cpp", "csharp", "css", "elixir", "go", "haskell", "html",
  "java", "javascript", "json", "kotlin", "lua", "nix", "php", "python",
  "ruby", "rust", "scala", "solidity", "swift", "typescript", "tsx", "yaml",
] as const;

const STRICTNESS = ["cst", "smart", "ast", "relaxed", "signature"] as const;

// The parsers bound `pattern`, `rewrite` and `inlineRules` with Buffer.byteLength (UTF-8
// BYTES) while JSON Schema `maxLength` counts Unicode CODE POINTS, so a maxLength keyword
// cannot express these budgets faithfully — a 10k-code-point CJK pattern is 30k bytes.
// The budget is therefore published in the description and the parser stays authoritative.
const PATTERN_BYTES_NOTE = "Max 16 KiB (16384 BYTES, UTF-8) — the limit counts bytes, not characters.";
const REWRITE_BYTES_NOTE = "Max 64 KiB (65536 BYTES, UTF-8) — the limit counts bytes, not characters.";
const INLINE_RULES_BYTES_NOTE = "Max 64 KiB (65536 BYTES, UTF-8) — the limit counts bytes, not characters.";

const pathsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  items: { type: "string", minLength: 1, maxLength: 4096 },
  description: "Files or directories to search. Required — there is no implicit '.' default.",
} as const;

const globsSchema = {
  type: "array",
  maxItems: 32,
  items: { type: "string", minLength: 1, maxLength: 1024 },
  description: "Optional include/exclude globs passed through to ast-grep.",
} as const;

const workdirSchema = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  description: "Working directory for the sg process. Defaults to the server's cwd.",
} as const;

const maxMatchesSchema = {
  type: "integer",
  minimum: 1,
  maximum: 500,
  description: "Maximum matches to return (default 50).",
} as const;

const timeoutMsSchema = {
  type: "integer",
  minimum: 1000,
  maximum: 300000,
  description: "Whole-call timeout budget in milliseconds (default 300000).",
} as const;

const includeHiddenSchema = { type: "boolean", description: "Include hidden files (--no-ignore hidden)." } as const;
const followSymlinksSchema = { type: "boolean", description: "Follow symlinks (--follow)." } as const;

export const AST_GREP_MCP_TOOLS: readonly McpToolDescriptor[] = [
  {
    name: SEARCH_TOOL_NAME,
    description: SEARCH_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, description: `ast-grep pattern — code, not regex. ${PATTERN_BYTES_NOTE}` },
        language: { type: "string", enum: [...LANGUAGES], description: "Language the pattern must parse in." },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        selector: { type: "string", minLength: 1, maxLength: 128, description: "Optional sub-node selector." },
        strictness: { type: "string", enum: [...STRICTNESS], description: "Match strictness (default smart)." },
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        force: { type: "boolean", description: "Bypass non-fatal pattern hint rejections." },
      },
      required: ["pattern", "language", "paths"],
      additionalProperties: false,
    },
  },
  {
    name: REWRITE_TOOL_NAME,
    description: REWRITE_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, description: `ast-grep pattern — code, not regex. ${PATTERN_BYTES_NOTE}` },
        rewrite: { type: "string", description: `Replacement code; empty deletes the match. ${REWRITE_BYTES_NOTE}` },
        language: { type: "string", enum: [...LANGUAGES], description: "Language the pattern must parse in." },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        selector: { type: "string", minLength: 1, maxLength: 128, description: "Optional sub-node selector." },
        strictness: { type: "string", enum: [...STRICTNESS], description: "Match strictness (default smart)." },
        apply: { type: "boolean", description: "Write the rewrite to disk. Default false (dry run)." },
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        force: { type: "boolean", description: "Bypass non-fatal pattern hint rejections." },
      },
      required: ["pattern", "rewrite", "language", "paths"],
      additionalProperties: false,
    },
  },
  {
    name: SCAN_TOOL_NAME,
    description: SCAN_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        ruleFile: { type: "string", minLength: 1, maxLength: 4096, description: "Path to a YAML rule file. Mutually exclusive with inlineRules." },
        inlineRules: {
          type: "string",
          minLength: 1,
          description: `Inline YAML rule text. Mutually exclusive with ruleFile. ${INLINE_RULES_BYTES_NOTE}`,
        },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        includeMetadata: { type: "boolean", description: "Include rule metadata in each match." },
        apply: { type: "boolean", description: "Write rule fixes to disk. Default false (dry run)." },
      },
      required: ["paths"],
      // Exactly one explicit rule source per call (ub §11): ruleFile XOR inlineRules.
      // The contract is published in both property descriptions and enforced by
      // parseScanInput, NOT by a schema-level oneOf/not: Cursor's AgentService gateway
      // cannot convert JSON-Schema composition keywords to protobuf and kills the entire
      // run with a wrapped `resource_exhausted` when it meets one. Same reasoning as the
      // byte budgets above — the parser stays authoritative, the schema stays portable.
      additionalProperties: false,
    },
  },
] as const;

// ---- options ----

export type ToolExecutor<Payload> = (
  input: never,
  sgPath: string,
  signal?: AbortSignal,
) => Promise<Payload>;

export interface AstGrepToolExecutors {
  readonly search?: ToolExecutor<SearchPayload>;
  readonly rewrite?: ToolExecutor<RewritePayload>;
  readonly scan?: ToolExecutor<ScanPayload>;
}

export interface AstGrepMcpOptions {
  /** Test seam: production callers leave this unset so the five-tier resolver runs. */
  readonly resolveSgPath?: () => string;
  /** Test seam: production callers leave this unset so the real tools run. */
  readonly executors?: AstGrepToolExecutors;
  readonly signal?: AbortSignal;
  readonly lifecycleLog?: McpLifecycleLog;
  /** Test seam: production callers leave this unset so the watchdog uses its defaults. */
  readonly parentWatchdog?: ParentWatchdogConfig;
}

// ---- request handling ----

export async function handleAstGrepMcpRequest(
  input: unknown,
  options: AstGrepMcpOptions = {},
): Promise<JsonRpcResponse | undefined> {
  if (!isPlainRecord(input)) return errorResponse(null, -32600, "Invalid Request");

  const id = jsonRpcId(input["id"]);
  const method = input["method"];

  if (method === "notifications/initialized") return undefined;
  if (method === "ping") return successResponse(id, {});
  if (method === "initialize") {
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: AST_GREP_SERVER_NAME, version: AST_GREP_SERVER_VERSION },
      protocolVersion: requestedProtocolVersion(input["params"]),
    });
  }
  if (method === "tools/list") return successResponse(id, { tools: [...AST_GREP_MCP_TOOLS] });
  if (method === "tools/call") return await handleToolCall(id, input["params"], options);

  return errorResponse(id, -32601, `Method not found: ${String(method)}`);
}

export async function runMcpStdioServer(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  options: AstGrepMcpOptions = {},
): Promise<void> {
  // One controller per in-flight request: dispatch is sequential, so the "active"
  // call is unambiguous, and parent death must abort the sg process it spawned.
  let active: AbortController | null = null;

  await runJsonRpcStdioServer({
    input,
    output,
    handler: async (request) => {
      const controller = new AbortController();
      active = controller;
      try {
        return await handleAstGrepMcpRequest(request, { ...options, signal: controller.signal });
      } finally {
        if (active === controller) active = null;
      }
    },
    handlerOptions: undefined,
    idleTimeoutMs: 0,
    parentWatchdog: options.parentWatchdog ?? {},
    log: options.lifecycleLog,
    onParentExit: () => {
      active?.abort(new Error("parent process exited"));
    },
  });
}

async function handleToolCall(
  id: JsonRpcId,
  params: unknown,
  options: AstGrepMcpOptions,
): Promise<JsonRpcResponse> {
  if (!isPlainRecord(params) || typeof params["name"] !== "string") {
    return errorResponse(id, -32602, "tools/call requires params.name");
  }

  const name = params["name"];
  const args = coerceToolArguments(params["arguments"]);

  if (name !== SEARCH_TOOL_NAME && name !== REWRITE_TOOL_NAME && name !== SCAN_TOOL_NAME) {
    return toolFailure(
      id,
      "INVALID_ARGUMENT",
      `Unknown ast_grep tool: ${name}. Available tools: ${AST_GREP_MCP_TOOLS.map((tool) => tool.name).join(", ")}.`,
    );
  }

  let sgPath: string;
  try {
    sgPath = resolveSgPath(options);
  } catch (error) {
    return toolFailure(id, "BINARY_NOT_FOUND", messageOf(error), hintsOf(error));
  }

  try {
    const payload = await dispatch(name, args, sgPath, options);
    return toolResponse(id, payload, payload.ok !== true);
  } catch (error) {
    if (error instanceof ToolArgumentError) {
      return toolFailure(id, "INVALID_ARGUMENT", error.message, [], { language: error.language });
    }
    return toolFailure(id, "SG_FAILED", messageOf(error));
  }
}

/** Schema rejection of tools/call arguments — a caller mistake, never an sg failure. */
class ToolArgumentError extends Error {
  readonly language: string;

  constructor(message: string, language: string) {
    super(message);
    this.name = "ToolArgumentError";
    this.language = language;
  }
}

async function dispatch(
  name: typeof SEARCH_TOOL_NAME | typeof REWRITE_TOOL_NAME | typeof SCAN_TOOL_NAME,
  args: Record<string, unknown>,
  sgPath: string,
  options: AstGrepMcpOptions,
): Promise<SearchPayload | RewritePayload | ScanPayload> {
  const executors = options.executors ?? {};
  const input = args as never;
  if (name === SEARCH_TOOL_NAME) {
    // executeSearch trusts its input (rewrite and scan parse internally, search does not),
    // so the MCP layer must validate here or a malformed call surfaces as an internal
    // TypeError instead of INVALID_ARGUMENT.
    let parsed: SearchInput;
    try {
      parsed = searchInputSchema.parse(args) as SearchInput;
    } catch (error) {
      throw new ToolArgumentError(messageOf(error), languageOf(args));
    }
    const execute = executors.search ?? ((value, path, signal) => executeSearch(value, path, signal));
    return await execute(parsed as never, sgPath, options.signal);
  }
  if (name === REWRITE_TOOL_NAME) {
    const execute = executors.rewrite ?? ((value, path, signal) => executeRewrite(value, path, signal));
    return await execute(input, sgPath, options.signal);
  }
  const execute = executors.scan ?? ((value, path, signal) => executeScan(value, path, signal));
  return await execute(input, sgPath, options.signal);
}

export function coerceToolArguments(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function resolveSgPath(options: AstGrepMcpOptions): string {
  if (options.resolveSgPath !== undefined) return options.resolveSgPath();
  const resolution = resolveSgBinarySync();
  if (!resolution.found) {
    throw Object.assign(new Error(resolution.error.message), { hints: resolution.error.hints });
  }
  return resolution.path;
}

function toolResponse(id: JsonRpcId, payload: unknown, isError: boolean): JsonRpcResponse {
  return successResponse(id, {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError,
  });
}

function toolFailure(
  id: JsonRpcId,
  code: AstGrepErrorCode,
  message: string,
  hints: readonly string[] = [],
  extra: Record<string, unknown> = {},
): JsonRpcResponse {
  return toolResponse(
    id,
    {
      schemaVersion: 1,
      ok: false,
      error: {
        code,
        message,
        retryable: false,
        phase: "preflight",
        ...extra,
        details: hints.length > 0 ? { hints } : {},
      },
    },
    true,
  );
}

function languageOf(args: Record<string, unknown>): string {
  return typeof args["language"] === "string" ? args["language"] : "unknown";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hintsOf(error: unknown): readonly string[] {
  if (!(error instanceof Error) || !("hints" in error)) return [];
  const hints = (error as { hints?: unknown }).hints;
  return Array.isArray(hints) ? hints.filter((hint): hint is string => typeof hint === "string") : [];
}

function requestedProtocolVersion(params: unknown): string {
  if (!isPlainRecord(params) || typeof params["protocolVersion"] !== "string") return DEFAULT_PROTOCOL_VERSION;
  return params["protocolVersion"];
}
