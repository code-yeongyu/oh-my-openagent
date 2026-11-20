const readCommands = new Set(["list_sessions", "get_protocol_info", "get_messages", "get_entries"])
const socketCodes = new Set(["EPIPE", "ECONNRESET", "ECONNREFUSED", "ENOENT", "ETIMEDOUT"])

type Phase = "connect" | "handshake" | "request" | "response-bytes" | "response-frame"

/** Never accept the endpoint, frame, auth bytes, or raw error message as output fields. */
export function readRpcDiagnostic(command: unknown) {
  if (process.env.OMO_THREAD_READ_TRACE !== "1" || typeof command !== "string" || !readCommands.has(command))
    return undefined
  const started = performance.now()
  let phase: Phase = "connect"
  return {
    at(next: Phase) {
      phase = next
    },
    failed(error: unknown) {
      const raw = error instanceof Error && "code" in error ? error.code : undefined
      const code =
        typeof raw === "string" && socketCodes.has(raw)
          ? raw
          : error instanceof Error && error.message === "thread RPC request timed out"
            ? "DEADLINE"
            : "OTHER"
      console.error(
        `[thread-read-rpc] command=${command} phase=${phase} elapsed_ms=${Math.round(performance.now() - started)} code=${code}`,
      )
    },
  }
}
