import type { McpClient, McpTransport } from "./types"
import { log } from "../logger"

export class McpEnvironmentPolicyChangedError extends Error {
  readonly retryable = true
  constructor() {
    super("MCP environment policy changed during connection; retry with the current grant snapshot.")
    this.name = "McpEnvironmentPolicyChangedError"
  }
}

export async function connectWithPolicySignal(
  client: McpClient, transport: McpTransport, signal?: AbortSignal,
): Promise<void> {
  if (!signal) return client.connect(transport)
  if (signal.aborted) throw new McpEnvironmentPolicyChangedError()
  const aborted = Promise.withResolvers<never>()
  const onAbort = () => {
    aborted.reject(new McpEnvironmentPolicyChangedError())
    for (const close of [() => transport.close(), () => client.close()]) {
      void close().catch((error: unknown) => {
        log("[skill-mcp-env] invalidated connection cleanup failed", { error: error instanceof Error ? error.name : "unknown" })
      })
    }
  }
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    await Promise.race([client.connect(transport), aborted.promise])
    if (signal.aborted) throw new McpEnvironmentPolicyChangedError()
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}
