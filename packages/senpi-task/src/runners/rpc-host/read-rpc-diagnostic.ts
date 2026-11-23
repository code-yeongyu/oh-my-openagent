/** Read commands answer the same however often they are sent: the ones a trace names and a dropped connection redials. */
const readCommands: ReadonlySet<string> = new Set(["list_sessions", "get_protocol_info", "get_messages", "get_entries"])

export function isReadCommand(command: unknown): command is string {
  return typeof command === "string" && readCommands.has(command)
}
const socketCodes = new Set(["EPIPE", "ECONNRESET", "ECONNREFUSED", "ENOENT", "ETIMEDOUT"])

type Phase = "connect" | "connected" | "handshake" | "request" | "response-bytes" | "response-frame"

/** Never accept the endpoint, frame, auth bytes, or raw error message as output fields. */
export function readRpcDiagnostic(command: unknown) {
  if (process.env.OMO_THREAD_READ_TRACE !== "1" || !isReadCommand(command)) return undefined
  const started = performance.now()
  let phase: Phase = "connect"
  let attempts = 1
  return {
    at(next: Phase) {
      phase = next
    },
    /** The connection was lost to a caller stall and is dialed again: a new conversation starts at `connect`. */
    redialed() {
      attempts += 1
      phase = "connect"
    },
    /** `stalledMs`: how long this process's own event loop was blocked during the last attempt. */
    failed(error: unknown, stalledMs: number) {
      const raw = error instanceof Error && "code" in error ? error.code : undefined
      const code =
        typeof raw === "string" && socketCodes.has(raw)
          ? raw
          : error instanceof Error && error.message === "thread RPC request timed out"
            ? "DEADLINE"
            : "OTHER"
      console.error(
        `[thread-read-rpc] command=${command} phase=${phase} elapsed_ms=${Math.round(performance.now() - started)} code=${code} caller_stall_ms=${Math.round(stalledMs)} attempts=${attempts}`,
      )
    },
  }
}
