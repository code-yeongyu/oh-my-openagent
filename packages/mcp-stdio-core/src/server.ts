import type { Readable, Writable } from "node:stream"
import { errorResponse, jsonRpcId, messageFromError } from "./responses.js"
import { isPlainRecord } from "./record.js"
import type { JsonRpcResponse, McpLifecycleLog } from "./types.js"
import { readStdioJsonRpcMessages, writeStdioJsonRpcResponse } from "./transport.js"
import type { StdioJsonRpcMessage } from "./transport.js"

export type McpRequestHandler<HandlerOptions> = (
  input: unknown,
  options: HandlerOptions,
) => Promise<JsonRpcResponse | undefined>

export interface JsonRpcStdioServerConfig<HandlerOptions> {
  readonly input: Readable
  readonly output: Writable
  readonly handler: McpRequestHandler<HandlerOptions>
  readonly handlerOptions: HandlerOptions
  readonly idleTimeoutMs?: number
  readonly onIdleTimeout?: () => void | Promise<void>
  readonly log?: McpLifecycleLog
  readonly parseErrorResponse?: (message: string) => JsonRpcResponse | undefined
  readonly onHandlerError?: (error: unknown) => void
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000
const noopLog: McpLifecycleLog = () => {}

export async function runJsonRpcStdioServer<HandlerOptions>(
  config: JsonRpcStdioServerConfig<HandlerOptions>,
): Promise<void> {
  const log = config.log ?? noopLog
  const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const idleTimer = createIdleTimer(idleTimeoutMs, log, config.onIdleTimeout)

  log("stdio_started", { cwd: process.cwd(), idle_timeout_ms: idleTimeoutMs })
  idleTimer.arm()
  try {
    for await (const message of readStdioJsonRpcMessages(config.input)) {
      if (idleTimer.closed()) break
      idleTimer.arm()
      if (message.kind === "parse_error") {
        if (!(await handleParseError(message, config, log))) break
        continue
      }
      if (!(await handleRequest(message, config, log))) break
    }
  } finally {
    idleTimer.clear()
    log("stdio_stopped")
  }
}

async function handleParseError<HandlerOptions>(
  message: Extract<StdioJsonRpcMessage, { readonly kind: "parse_error" }>,
  config: JsonRpcStdioServerConfig<HandlerOptions>,
  log: McpLifecycleLog,
): Promise<boolean> {
  log("parse_error", { message: message.message })
  const response = config.parseErrorResponse?.(message.message) ?? errorResponse(null, -32700, "Parse error", message.message)
  if (response === undefined) return true
  return writeResponse(response, {
    output: config.output,
    responseMode: message.responseMode,
    log,
  })
}

async function handleRequest<HandlerOptions>(
  message: Extract<StdioJsonRpcMessage, { readonly kind: "request" }>,
  config: JsonRpcStdioServerConfig<HandlerOptions>,
  log: McpLifecycleLog,
): Promise<boolean> {
  const parsed = message.payload
  const id = isPlainRecord(parsed) ? jsonRpcId(parsed["id"]) : null
  const method = isPlainRecord(parsed) && typeof parsed["method"] === "string" ? parsed["method"] : null
  log("request", { id: id === null ? null : String(id), method })
  let response: JsonRpcResponse | undefined
  try {
    response = await config.handler(parsed, config.handlerOptions)
  } catch (error) {
    if (config.onHandlerError === undefined) throw error
    config.onHandlerError(error)
    return true
  }
  if (response === undefined) return true
  if (
    !(await writeResponse(response, {
      output: config.output,
      responseMode: message.responseMode,
      log,
    }))
  ) return false
  log("response", { id: String(response.id), method, is_error: response.error !== undefined })
  return true
}

async function writeResponse(
  response: JsonRpcResponse,
  context: ResponseWriteContext,
): Promise<boolean> {
  try {
    await writeStdioJsonRpcResponse(context.output, response, context.responseMode)
    return true
  } catch (error) {
    if (!isTerminalOutputError(error)) throw error
    context.log("output_error", { message: messageFromError(error) })
    return false
  }
}

function isTerminalOutputError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false
  return error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED" || error.code === "ERR_STREAM_WRITE_AFTER_END"
}

interface ResponseWriteContext {
  readonly output: Writable
  readonly responseMode: StdioJsonRpcMessage["responseMode"]
  readonly log: McpLifecycleLog
}

function createIdleTimer(
  idleTimeoutMs: number,
  log: McpLifecycleLog,
  onIdleTimeout?: () => void | Promise<void>,
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let isClosed = false

  return {
    arm: () => {
      if (timer !== null) clearTimeout(timer)
      if (idleTimeoutMs <= 0) return
      timer = setTimeout(() => {
        isClosed = true
        log("idle_timeout", { idle_timeout_ms: idleTimeoutMs })
        void onIdleTimeout?.()
      }, idleTimeoutMs)
      timer.unref()
    },
    clear: () => {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
    },
    closed: () => isClosed,
  }
}
