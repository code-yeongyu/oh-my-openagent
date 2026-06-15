import type { Readable, Writable } from "node:stream";
import {
  errorResponse,
  isPlainRecord,
  jsonRpcId,
  messageFromError,
  successResponse,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcResponse,
  type JsonRpcResult,
  type McpToolDescriptor,
  type TextContent,
} from "@oh-my-opencode/mcp-stdio-core";
import { CLI_LANGUAGES } from "./constants";
import { runJsonRpcStdioServer, type McpStdioServerOptions } from "./mcp-stdio-server";
import { getPatternHint } from "./pattern-hints";
import { formatReplaceResult, formatSearchResult } from "./result-formatter";
import { runSg, type RunOptions } from "./runner";
import { AST_GREP_REPLACE_DESCRIPTION, AST_GREP_SEARCH_DESCRIPTION, AST_GREP_SEARCH_PATTERN_PARAM } from "./tool-descriptions";
import type { CliLanguage, SgResult } from "./types";
import { normalizeWorkspaceDirectory, resolveWorkspacePaths } from "./workspace-paths";

export type { JsonRpcError, JsonRpcId, JsonRpcResponse, JsonRpcResult, McpToolDescriptor, TextContent };

export interface AstGrepMcpOptions {
  readonly workspaceDirectory?: string;
  readonly disabledTools?: readonly string[];
  readonly runSg?: (options: RunOptions) => Promise<SgResult>;
}

type ToolCallResult = {
  readonly content: readonly TextContent[];
  readonly isError?: boolean;
};

const SERVER_NAME = "ast_grep";
const SERVER_VERSION = "0.1.0";
const LANGUAGE_VALUES: readonly string[] = CLI_LANGUAGES;
const DISABLED_TOOLS_ENV = "OMO_AST_GREP_DISABLED_TOOLS";

const AST_GREP_MCP_TOOLS = [
  {
    name: "search",
    title: "AST grep search",
    description: AST_GREP_SEARCH_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: AST_GREP_SEARCH_PATTERN_PARAM },
        lang: { type: "string", enum: CLI_LANGUAGES, description: "Target language" },
        paths: { type: "array", items: { type: "string" }, description: "Paths to search" },
        globs: { type: "array", items: { type: "string" }, description: "Include/exclude globs" },
        context: { type: "number", description: "Context lines around each match" },
      },
      required: ["pattern", "lang"],
      additionalProperties: false,
    },
  },
  {
    name: "replace",
    title: "AST grep replace",
    description: AST_GREP_REPLACE_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "AST pattern to match" },
        rewrite: { type: "string", description: "Replacement pattern" },
        lang: { type: "string", enum: CLI_LANGUAGES, description: "Target language" },
        paths: { type: "array", items: { type: "string" }, description: "Paths to search" },
        globs: { type: "array", items: { type: "string" }, description: "Include/exclude globs" },
        dryRun: { type: "boolean", description: "Preview changes without applying. Defaults to true." },
      },
      required: ["pattern", "rewrite", "lang"],
      additionalProperties: false,
    },
  },
] as const satisfies readonly McpToolDescriptor[];

export async function handleAstGrepMcpRequest(input: unknown, options: AstGrepMcpOptions = {}): Promise<JsonRpcResponse | undefined> {
  if (!isPlainRecord(input)) return errorResponse(null, -32600, "Invalid Request");
  const id = jsonRpcId(input["id"]);
  if (input["method"] === "notifications/initialized") return undefined;
  if (input["method"] === "ping") return successResponse(id, {});
  if (input["method"] === "initialize") {
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      protocolVersion: requestedProtocolVersion(input["params"]),
    });
  }
  if (input["method"] === "tools/list") return successResponse(id, { tools: enabledTools(options) });
  if (input["method"] === "tools/call") return handleToolCall(id, input["params"], options);
  return errorResponse(id, -32601, `Method not found: ${String(input["method"])}`);
}

export async function runMcpStdioServer(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  options: AstGrepMcpOptions = {},
  stdioOptions: McpStdioServerOptions = {},
): Promise<void> {
  await runJsonRpcStdioServer(handleAstGrepMcpRequest, input, output, options, stdioOptions);
}

async function handleToolCall(id: JsonRpcId, params: unknown, options: AstGrepMcpOptions): Promise<JsonRpcResponse> {
  if (!isPlainRecord(params) || typeof params["name"] !== "string") return errorResponse(id, -32602, "tools/call requires params.name");
  try {
    const result = await executeAstGrepTool(params["name"], params["arguments"], options);
    return successResponse(id, { content: result.content, isError: result.isError ?? false });
  } catch (error) {
    return successResponse(id, { content: [{ type: "text", text: messageFromError(error) }], isError: true });
  }
}

async function executeAstGrepTool(name: string, args: unknown, options: AstGrepMcpOptions): Promise<ToolCallResult> {
  if (disabledToolNames(options).has(name)) throw new Error(`ast-grep tool is disabled: ${name}`);
  const runner = options.runSg ?? runSg;
  const workspaceDirectory = normalizeWorkspaceDirectory(options.workspaceDirectory ?? process.env.OMO_AST_GREP_WORKSPACE ?? process.cwd());
  if (name === "search") {
    const input = parseSearchArgs(args, workspaceDirectory);
    const result = await runner(input);
    let output = formatSearchResult(result);
    if (result.matches.length === 0 && !result.error) {
      const hint = getPatternHint(input.pattern, input.lang);
      if (hint) output += `\n\n${hint}`;
    }
    return { content: [{ type: "text", text: output }], isError: Boolean(result.error) };
  }
  if (name === "replace") {
    const input = parseReplaceArgs(args, workspaceDirectory);
    const result = await runner(input.options);
    return { content: [{ type: "text", text: formatReplaceResult(result, input.dryRun) }], isError: Boolean(result.error) };
  }
  throw new Error(`Unknown ast-grep tool: ${name}`);
}

function parseSearchArgs(args: unknown, workspaceDirectory: string): RunOptions {
  const input = requireRecord(args);
  return {
    pattern: requireString(input, "pattern"),
    lang: requireLanguage(input, "lang"),
    cwd: workspaceDirectory,
    paths: resolveWorkspacePaths(optionalStringArray(input, "paths"), workspaceDirectory),
    globs: optionalStringArray(input, "globs"),
    context: optionalNumber(input, "context"),
  };
}

function parseReplaceArgs(args: unknown, workspaceDirectory: string): { readonly options: RunOptions; readonly dryRun: boolean } {
  const input = requireRecord(args);
  const dryRun = optionalBoolean(input, "dryRun") ?? true;
  return {
    dryRun,
    options: {
      pattern: requireString(input, "pattern"),
      rewrite: requireString(input, "rewrite"),
      lang: requireLanguage(input, "lang"),
      cwd: workspaceDirectory,
      paths: resolveWorkspacePaths(optionalStringArray(input, "paths"), workspaceDirectory),
      globs: optionalStringArray(input, "globs"),
      updateAll: !dryRun,
    },
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error("Tool arguments must be an object");
  return value;
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function requireLanguage(input: Record<string, unknown>, key: string): CliLanguage {
  const value = requireString(input, key);
  if (!isCliLanguage(value)) throw new Error(`${key} must be one of: ${LANGUAGE_VALUES.join(", ")}`);
  return value;
}

function isCliLanguage(value: string): value is CliLanguage {
  return LANGUAGE_VALUES.includes(value);
}

function optionalStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${key} must be an array of strings`);
  return value;
}

function enabledTools(options: AstGrepMcpOptions): McpToolDescriptor[] {
  const disabled = disabledToolNames(options);
  return AST_GREP_MCP_TOOLS.filter((tool) => !disabled.has(tool.name));
}

function disabledToolNames(options: AstGrepMcpOptions): ReadonlySet<string> {
  const fromOptions = options.disabledTools ?? [];
  const fromEnv = process.env[DISABLED_TOOLS_ENV]?.split(",") ?? [];
  return new Set([...fromOptions, ...fromEnv].map((tool) => tool.trim()).filter(Boolean));
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new Error(`${key} must be a number`);
  return value;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function requestedProtocolVersion(params: unknown): string {
  if (!isPlainRecord(params) || typeof params["protocolVersion"] !== "string") return "2024-11-05";
  return params["protocolVersion"];
}
