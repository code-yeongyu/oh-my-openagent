import type { Readable, Writable } from "node:stream";
import { errorResponse, isPlainRecord, jsonRpcId, runJsonRpcStdioServer, successResponse } from "@oh-my-opencode/mcp-stdio-core";
import type { JsonRpcResponse } from "@oh-my-opencode/mcp-stdio-core";
import { resolveGitBash, resolveGitBashForCurrentProcess, type GitBashResolution } from "./git-bash-resolver";
import { runGitBashCommand, type GitBashRunResult, type RunGitBashCommand } from "./runner";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const EXEC_COMMAND_TIMEOUT_ENV_KEYS = [
  "OMO_CODEX_GIT_BASH_TIMEOUT_MS",
  "OMO_CODEX_EXEC_COMMAND_TIMEOUT_MS",
  "CODEX_EXEC_COMMAND_TIMEOUT_MS",
  "EXEC_COMMAND_TIMEOUT_MS",
] as const;

export interface GitBashMcpOptions {
  readonly platform?: string;
  readonly env?: { readonly [key: string]: string | undefined };
  readonly exists?: (path: string) => boolean;
  readonly where?: (command: "bash") => readonly string[];
  readonly runGitBash?: RunGitBashCommand;
  readonly defaultTimeoutMs?: number;
}

export type { JsonRpcResponse };

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export async function handleGitBashMcpRequest(input: unknown, options: GitBashMcpOptions = {}): Promise<JsonRpcResponse | undefined> {
  if (!isPlainRecord(input)) return errorResponse(null, -32600, "Invalid Request");
  const id = jsonRpcId(input["id"]);
  const method = typeof input["method"] === "string" ? input["method"] : null;

  if (method === "initialize") {
    const protocolVersion = protocolVersionFromInput(input) ?? "2024-11-05";
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "git_bash", version: "0.1.0" },
      protocolVersion,
    });
  }

  if (method === "tools/list") return successResponse(id, { tools: toolsForOptions(options) });

  if (method === "tools/call") {
    const params = isPlainRecord(input["params"]) ? input["params"] : {};
    const name = typeof params["name"] === "string" ? params["name"] : "";
    const args = isPlainRecord(params["arguments"]) ? params["arguments"] : {};
    return await callTool(id, name, args, options);
  }

  if (method === "notifications/initialized") return undefined;

  return errorResponse(id, -32601, "Method not found");
}

export async function runMcpStdioServer(input: Readable, output: Writable, options: GitBashMcpOptions = {}): Promise<void> {
  if (!canRunGitBash(options)) return;

  await runJsonRpcStdioServer({
    input,
    output,
    handler: handleGitBashMcpRequest,
    handlerOptions: options,
    parseErrorResponse: () => errorResponse(null, -32601, "Method not found"),
  });
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

  const cwd = parseWorkdir(args);
  if (cwd === null) return toolResponse(id, "run.workdir must be a non-empty string when provided.", true);

  const timeoutMs = parseTimeoutMs(args.timeout ?? args.timeout_ms, options);
  if (timeoutMs === null) return toolResponse(id, `run.timeout must be an integer between 1 and ${MAX_TIMEOUT_MS}.`, true);

  const resolution = resolve(options);
  if (!resolution.found || resolution.path === null) return toolResponse(id, whichBashPayload(resolution), true);

  try {
    const run = options.runGitBash ?? runGitBashCommand;
    const result = await run({ bashPath: resolution.path, command, cwd, timeoutMs, env: options.env ?? process.env });
    return toolResponse(id, runPayload(result));
  } catch (error) {
    return toolResponse(id, error instanceof Error ? error.message : String(error), true);
  }
}

function toolsForOptions(options: GitBashMcpOptions): ToolDefinition[] {
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
  if (!canRunGitBash(options)) return sharedTools;
  return [
    {
      name: "run",
      description:
        "Run a shell command through Git Bash on native Windows. Prefer this git_bash run tool for bash/shell commands on Windows before built-in exec_command or Bash; use exec_command only when git_bash is unavailable or for non-shell operations.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute." },
          timeout: {
            type: "integer",
            minimum: 1,
            maximum: MAX_TIMEOUT_MS,
            description: `Optional timeout in milliseconds. If omitted, uses the inherited exec_command timeout when configured; otherwise ${defaultTimeoutMs(options)}ms.`,
          },
          workdir: {
            type: "string",
            description: "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
          },
          description: {
            type: "string",
            description: "Clear, concise description of what this command does in 5-10 words.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
    ...sharedTools,
  ];
}

function canRunGitBash(options: GitBashMcpOptions): boolean {
  if (platformFromOptions(options) !== "win32") return false;
  const resolution = resolve(options);
  return resolution.found && resolution.path !== null;
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

function parseWorkdir(args: Record<string, unknown>): string | undefined | null {
  const value = args.workdir ?? args.cwd;
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseTimeoutMs(value: unknown, options: GitBashMcpOptions): number | null {
  if (value === undefined) return defaultTimeoutMs(options);
  return normalizeTimeoutMs(value);
}

function defaultTimeoutMs(options: GitBashMcpOptions): number {
  const configured = normalizeTimeoutMs(options.defaultTimeoutMs);
  if (configured !== null) return configured;
  const env = options.env ?? process.env;
  for (const key of EXEC_COMMAND_TIMEOUT_ENV_KEYS) {
    const timeoutMs = normalizeTimeoutMs(env[key]);
    if (timeoutMs !== null) return timeoutMs;
  }
  return DEFAULT_TIMEOUT_MS;
}

function normalizeTimeoutMs(value: unknown): number | null {
  const parsed = typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
  if (!Number.isInteger(parsed)) return null;
  const timeoutMs = Number(parsed);
  if (timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return null;
  return timeoutMs;
}

function protocolVersionFromInput(input: Record<string, unknown>): string | null {
  if (!isPlainRecord(input["params"])) return null;
  const params = input["params"];
  return typeof params["protocolVersion"] === "string" ? params["protocolVersion"] : null;
}
