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

export interface ParentWatchdogConfig {
  readonly parentPid?: number
  readonly pollIntervalMs?: number
  // Injectable so tests do not depend on OS process semantics.
  readonly probeAlive?: (pid: number) => boolean
}

export interface JsonRpcStdioServerConfig<HandlerOptions> {
  readonly input: Readable
  readonly output: Writable
  readonly handler: McpRequestHandler<HandlerOptions>
  readonly handlerOptions: HandlerOptions
  readonly idleTimeoutMs?: number
  readonly onIdleTimeout?: () => void | Promise<void>
  // Opt-in parent-liveness watchdog. Callers that intentionally outlive their
  // parent (e.g. the daemon server, which is deliberately detached) must not
  // pass this option; when absent no timer is created at all.
  readonly parentWatchdog?: ParentWatchdogConfig
  readonly onParentExit?: () => void | Promise<void>
  readonly log?: McpLifecycleLog
  readonly parseErrorResponse?: (message: string) => JsonRpcResponse | undefined
  readonly onHandlerError?: (error: unknown) => void
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000
const DEFAULT_PARENT_POLL_INTERVAL_MS = 30_000
const noopLog: McpLifecycleLog = () => {}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH means no such process: the parent is gone. EPERM means the process
    // exists but may not be signalled by us, so it is alive. Node implements
    // process.kill(pid, 0) on win32 via OpenProcess, which reports ESRCH once
    // the process exits, so this probe is cross-platform; never fall back to a
    // ppid === 1 reparenting check, which is invalid on win32.
    if (hasErrorCode(error, "ESRCH")) return false
    if (hasErrorCode(error, "EPERM")) return true
    throw error
  }
}

export async function runJsonRpcStdioServer<HandlerOptions>(
  config: JsonRpcStdioServerConfig<HandlerOptions>,
): Promise<void> {
  const log = config.log ?? noopLog
  const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  let isClosed = false
  const idleTimer = createIdleTimer(idleTimeoutMs, log, () => {
    isClosed = true
    void config.onIdleTimeout?.()
  })
  const watchdog = createParentWatchdog(config.parentWatchdog, (parentPid, pollIntervalMs) => {
    isClosed = true
    log("parent_exit", { parent_pid: parentPid, poll_interval_ms: pollIntervalMs })
    void config.onParentExit?.()
    // Stop the read loop so the server settles through the same finally path as
    // an idle timeout; destroying the input surfaces as ERR_STREAM_PREMATURE_CLOSE
    // below and is swallowed because we initiated the close.
    config.input.destroy()
  })

  log("stdio_started", { cwd: process.cwd(), idle_timeout_ms: idleTimeoutMs })
  idleTimer.arm()
  try {
    for await (const message of readStdioJsonRpcMessages(config.input)) {
      if (isClosed) break
      idleTimer.arm()
      if (message.kind === "parse_error") {
        if (!(await handleParseError(message, config, log))) break
        continue
      }
      if (!(await handleRequest(message, config, log))) break
    }
  } catch (error) {
    if (!(isClosed && hasErrorCode(error, "ERR_STREAM_PREMATURE_CLOSE"))) throw error
  } finally {
    idleTimer.clear()
    watchdog.clear()
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

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

function createParentWatchdog(
  config: ParentWatchdogConfig | undefined,
  onDeadParent: (parentPid: number, pollIntervalMs: number) => void,
): { readonly clear: () => void } {
  // Strictly opt-in: no option means no timer, so existing consumers (and
  // intentionally detached processes such as the daemon server, which never
  // passes this option) see zero behaviour change.
  if (config === undefined) return { clear: () => {} }
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_PARENT_POLL_INTERVAL_MS
  if (pollIntervalMs <= 0) return { clear: () => {} }
  const parentPid = config.parentPid ?? process.ppid
  const probeAlive = config.probeAlive ?? isProcessAlive
  let fired = false
  const timer = setInterval(() => {
    if (fired || probeAlive(parentPid)) return
    fired = true
    onDeadParent(parentPid, pollIntervalMs)
  }, pollIntervalMs)
  timer.unref()
  return {
    clear: () => {
      clearInterval(timer)
    },
  }
}

function createIdleTimer(
  idleTimeoutMs: number,
  log: McpLifecycleLog,
  onTimeout: () => void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    arm: () => {
      if (timer !== null) clearTimeout(timer)
      if (idleTimeoutMs <= 0) return
      timer = setTimeout(() => {
        log("idle_timeout", { idle_timeout_ms: idleTimeoutMs })
        onTimeout()
      }, idleTimeoutMs)
      timer.unref()
    },
    clear: () => {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
    },
  }
}
