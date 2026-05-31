import type { Readable, Writable } from "node:stream";
import { resolveGitBash, resolveGitBashForCurrentProcess, type GitBashResolution } from "./git-bash-resolver";
import { runGitBashCommand, type GitBashRunResult, type RunGitBashCommand } from "./runner";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 30 * 60_000;

export interface GitBashMcpOptions {
  readonly platform?: string;
  readonly env?: { readonly [key: string]: string | undefined };
  readonly exists?: (path: string) => boolean;
  readonly where?: (command: "bash") => readonly string[];
  readonly runGitBash?: RunGitBashCommand;
}

export type JsonRpcResponse =
  | {
      readonly jsonrpc: "2.0";
      readonly id: string | number | null;
      readonly result: Record<string, unknown>;
    }
  | {
      readonly jsonrpc: "2.0";
      readonly id: string | number | null;
      readonly error: {
        readonly code: number;
        readonly message: string;
        readonly data?: unknown;
      };
    };

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export async function handleGitBashMcpRequest(input: unknown, options: GitBashMcpOptions = {}): Promise<JsonRpcResponse | undefined> {
  if (!isRecord(input)) return errorResponse(null, -32600, "Invalid Request");
  const id = jsonRpcId(input.id);
  const method = typeof input.method === "string" ? input.method : null;

  if (method === "initialize") {
    const protocolVersion = protocolVersionFromInput(input) ?? "2024-11-05";
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "git_bash", version: "0.1.0" },
      protocolVersion,
    });
  }

  if (method === "tools/list") return successResponse(id, { tools: toolsForPlatform(platformFromOptions(options)) });

  if (method === "tools/call") {
    const params = isRecord(input.params) ? input.params : {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = isRecord(params.arguments) ? params.arguments : {};
    return await callTool(id, name, args, options);
  }

  if (method === "notifications/initialized") return undefined;

  return errorResponse(id, -32601, "Method not found");
}

export async function runMcpStdioServer(input: Readable, output: Writable, options: GitBashMcpOptions = {}): Promise<void> {
  let buffer = "";
  for await (const chunk of input) {
    buffer += String(chunk);
    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) break;
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (line.length === 0) continue;
      const response = await handleGitBashMcpRequest(parseJsonRpcLine(line), options);
      if (response !== undefined) output.write(`${JSON.stringify(response)}\n`);
    }
  }
}

async function callTool(id: string | number | null, name: string, args: Record<string, unknown>, options: GitBashMcpOptions): Promise<JsonRpcResponse> {
  if (name === "which_bash") return toolResponse(id, whichBashPayload(resolve(options)));
  if (name === "diagnose") return toolResponse(id, diagnosePayload(resolve(options), platformFromOptions(options)));
  if (name === "run") return await runToolResponse(id, args, options);
  return toolResponse(id, `Unknown git_bash tool: ${name}`, true);
}

async function runToolResponse(id: string | number | null, args: Record<string, unknown>, options: GitBashMcpOptions): Promise<JsonRpcResponse> {
  const platform = platformFromOptions(options);
  if (platform !== "win32") return toolResponse(id, "git_bash run is only available on native Windows.", true);

  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (command.length === 0) return toolResponse(id, "run.command must be a non-empty string.", true);

  const cwd = args.cwd === undefined ? undefined : typeof args.cwd === "string" && args.cwd.trim().length > 0 ? args.cwd : null;
  if (cwd === null) return toolResponse(id, "run.cwd must be a non-empty string when provided.", true);

  const timeoutMs = parseTimeoutMs(args.timeout_ms);
  if (timeoutMs === null) return toolResponse(id, `run.timeout_ms must be an integer between 1 and ${MAX_TIMEOUT_MS}.`, true);

  const resolution = resolve(options);
  if (!resolution.found || resolution.path === null) return toolResponse(id, whichBashPayload(resolution), true);

  try {
    const run = options.runGitBash ?? runGitBashCommand;
    const result = await run({ bashPath: resolution.path, command, cwd, timeoutMs, env: process.env });
    return toolResponse(id, runPayload(result));
  } catch (error) {
    return toolResponse(id, error instanceof Error ? error.message : String(error), true);
  }
}

function toolsForPlatform(platform: string): readonly ToolDefinition[] {
  const sharedTools: ToolDefinition[] = [
    {
      name: "which_bash",
      description: "Resolve the Git Bash bash.exe path used by the git_bash MCP.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "diagnose",
      description: "Report whether Git Bash command execution is available on this host.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
  if (platform !== "win32") return sharedTools;
  return [
    {
      name: "run",
      description: "Run a shell command through Git Bash on native Windows.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
          timeout_ms: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
    ...sharedTools,
  ];
}

function resolve(options: GitBashMcpOptions): GitBashResolution {
  if (options.exists === undefined && options.where === undefined) {
    return resolveGitBashForCurrentProcess({
      platform: options.platform,
      env: options.env,
    });
  }

  return resolveGitBash({
    platform: platformFromOptions(options),
    env: options.env ?? process.env,
    exists: options.exists ?? (() => false),
    where: options.where ?? (() => []),
  });
}

function platformFromOptions(options: GitBashMcpOptions): string {
  return options.platform ?? process.platform;
}

function whichBashPayload(resolution: GitBashResolution): string {
  return JSON.stringify(resolution, null, 2);
}

function diagnosePayload(resolution: GitBashResolution, platform: string): string {
  const enabled = platform === "win32" && resolution.found && resolution.path !== null;
  const payload = {
    platform,
    enabled,
    status: platform === "win32" ? (enabled ? "ready" : "missing-git-bash") : "disabled: git_bash command execution is only exposed on native Windows",
    resolution,
  };
  return JSON.stringify(payload, null, 2);
}

function runPayload(result: GitBashRunResult): string {
  return JSON.stringify(result, null, 2);
}

function toolResponse(id: string | number | null, text: string, isError = false): JsonRpcResponse {
  return successResponse(id, { content: [{ type: "text", text }], isError });
}

function successResponse(id: string | number | null, result: Record<string, unknown>): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function parseTimeoutMs(value: unknown): number | null {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value)) return null;
  const timeoutMs = Number(value);
  if (timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return null;
  return timeoutMs;
}

function protocolVersionFromInput(input: Record<string, unknown>): string | null {
  if (!isRecord(input.params)) return null;
  return typeof input.params.protocolVersion === "string" ? input.params.protocolVersion : null;
}

function parseJsonRpcLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    return { jsonrpc: "2.0", id: null, method: null, parseError: error instanceof Error ? error.message : String(error) };
  }
}

function jsonRpcId(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
