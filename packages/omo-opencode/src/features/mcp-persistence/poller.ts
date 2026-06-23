import { log } from "../../shared"
import { applyMcpStateChanges, readPersistedMcpStates } from "./config-writer"
import { diffMcpStates } from "./diff"
import { fetchRuntimeMcpStates, type McpStateFetcherClient } from "./state-fetcher"

export interface McpPersistencePollerOptions {
  client: McpStateFetcherClient
  directory: string
  intervalMs?: number
}

const DEFAULT_INTERVAL_MS = 5000

export class McpPersistencePoller {
  readonly #client: McpStateFetcherClient
  readonly #directory: string
  readonly #intervalMs: number
  #timer: ReturnType<typeof setInterval> | undefined
  #started = false
  #inflight = false

  constructor(options: McpPersistencePollerOptions) {
    this.#client = options.client
    this.#directory = options.directory
    this.#intervalMs = Math.max(500, options.intervalMs ?? DEFAULT_INTERVAL_MS)
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    log("[mcp-persistence] started", {
      directory: this.#directory,
      interval_ms: this.#intervalMs,
    })
    this.#timer = setInterval(() => {
      void this.tickOnce().catch((e) => {
        log("[mcp-persistence/tick] unhandled error", {
          message: e instanceof Error ? e.message : String(e),
        })
      })
    }, this.#intervalMs)
  }

  stop(): void {
    if (!this.#started) return
    this.#started = false
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = undefined
    }
    log("[mcp-persistence] stopped", { directory: this.#directory })
  }

  async tickOnce(): Promise<{ changes: number; written: boolean }> {
    if (this.#inflight) return { changes: 0, written: false }
    this.#inflight = true
    try {
      const runtime = await fetchRuntimeMcpStates(this.#client, this.#directory)
      const persisted = readPersistedMcpStates({ directory: this.#directory })
      const changes = diffMcpStates(runtime, persisted)
      if (changes.length === 0) return { changes: 0, written: false }
      const writeResult = applyMcpStateChanges(
        { directory: this.#directory },
        changes.map((c) => ({ name: c.name, to: c.to })),
      )
      if (writeResult.written) {
        log("[mcp-persistence] persisted runtime mcp state to project config", {
          path: writeResult.path,
          changes: changes.map((c) => ({ name: c.name, from: c.from, to: c.to })),
        })
      }
      return { changes: changes.length, written: writeResult.written }
    } finally {
      this.#inflight = false
    }
  }
}
