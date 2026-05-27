import { createInterface } from "node:readline";

import type { AstGrepMcpOptions, JsonRpcResponse } from "./mcp";

export type McpLifecycleLog = (event: string, fields?: Record<string, boolean | number | string | null>) => void;

export interface McpStdioServerOptions {
  readonly idleTimeoutMs?: number;
  readonly onIdleTimeout?: () => void | Promise<void>;
  readonly log?: McpLifecycleLog;
}

export type McpRequestHandler = (
  input: unknown,
  options: AstGrepMcpOptions,
) => Promise<JsonRpcResponse | undefined>;

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
const noopLog: McpLifecycleLog = () => {};

export async function runJsonRpcStdioServer(
  handler: McpRequestHandler,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  options: AstGrepMcpOptions,
  stdioOptions: McpStdioServerOptions = {},
): Promise<void> {
  const log = stdioOptions.log ?? noopLog;
  const idleTimeoutMs = stdioOptions.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const idleTimer = createIdleTimer(idleTimeoutMs, log, stdioOptions.onIdleTimeout);

  log("stdio_started", { cwd: process.cwd(), idle_timeout_ms: idleTimeoutMs });
  idleTimer.arm();
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of lines) {
      if (idleTimer.closed()) break;
      idleTimer.arm();
      if (!line.trim()) continue;
      const parsed = parseJsonRpcLine(line, output, log);
      if (parsed === undefined) continue;
      const id = isRecord(parsed) ? jsonRpcId(parsed.id) : null;
      const method = isRecord(parsed) && typeof parsed.method === "string" ? parsed.method : null;
      log("request", { id: id === null ? null : String(id), method });
      const response = await handler(parsed, options);
      if (response) {
        output.write(`${JSON.stringify(response)}\n`);
        log("response", { id: String(response.id), method, is_error: response.error !== undefined });
      }
    }
  } finally {
    idleTimer.clear();
    log("stdio_stopped");
  }
}

function createIdleTimer(idleTimeoutMs: number, log: McpLifecycleLog, onIdleTimeout?: () => void | Promise<void>) {
  let timer: NodeJS.Timeout | null = null;
  let isClosed = false;

  return {
    arm: () => {
      if (timer !== null) clearTimeout(timer);
      if (idleTimeoutMs <= 0) return;
      timer = setTimeout(() => {
        isClosed = true;
        log("idle_timeout", { idle_timeout_ms: idleTimeoutMs });
        void onIdleTimeout?.();
      }, idleTimeoutMs);
      timer.unref();
    },
    clear: () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
    closed: () => isClosed,
  };
}

function parseJsonRpcLine(line: string, output: NodeJS.WritableStream, log: McpLifecycleLog): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch (error) {
    const message = messageFromError(error);
    log("parse_error", { message });
    output.write(`${JSON.stringify(errorResponse(null, -32700, "Parse error", message))}\n`);
    return undefined;
  }
}

function errorResponse(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function jsonRpcId(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
