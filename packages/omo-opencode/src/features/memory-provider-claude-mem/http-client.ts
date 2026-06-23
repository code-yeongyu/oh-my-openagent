import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type {
  ClaudeMemHealthResponse,
  ClaudeMemSearchParams,
  ClaudeMemSearchResponse,
  ClaudeMemAddObservationRequest,
  ClaudeMemWorkerConfig,
} from "./types"

export class ClaudeMemHttpClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = "ClaudeMemHttpClientError"
  }
}

const DEFAULT_CONFIG: ClaudeMemWorkerConfig = {
  baseUrl: "http://localhost:37777",
  timeoutMs: 30_000,
  pidFilePath: join(homedir(), ".claude-mem", "worker.pid"),
}

export class ClaudeMemHttpClient {
  private readonly config: ClaudeMemWorkerConfig

  constructor(config: Partial<ClaudeMemWorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async isWorkerProcessAlive(): Promise<boolean> {
    const pidFile = this.config.pidFilePath
    if (!pidFile || !existsSync(pidFile)) return false
    try {
      const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10)
      if (Number.isNaN(pid)) return false
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  async health(): Promise<ClaudeMemHealthResponse> {
    const response = await this.fetchWithTimeout("/api/health")
    if (!response.ok) {
      throw new ClaudeMemHttpClientError(
        `Health check failed: ${response.status}`,
        response.status,
      )
    }
    return (await response.json()) as ClaudeMemHealthResponse
  }

  async search(params: ClaudeMemSearchParams): Promise<ClaudeMemSearchResponse> {
    const searchParams = new URLSearchParams()
    searchParams.set("query", params.q)
    if (params.limit !== undefined) searchParams.set("limit", String(params.limit))
    if (params.project) searchParams.set("project", params.project)
    if (params.type) searchParams.set("type", params.type)
    if (params.obs_type) searchParams.set("obs_type", params.obs_type)
    if (params.date_start) searchParams.set("date_start", params.date_start)
    if (params.date_end) searchParams.set("date_end", params.date_end)

    const response = await this.fetchWithTimeout(`/api/search?${searchParams.toString()}`)
    if (!response.ok) {
      throw new ClaudeMemHttpClientError(
        `Search failed: ${response.status}`,
        response.status,
      )
    }
    return (await response.json()) as ClaudeMemSearchResponse
  }

  async addObservation(request: ClaudeMemAddObservationRequest): Promise<void> {
    const initResponse = await this.fetchWithTimeout("/api/sessions/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentSessionId: request.session_id,
        project: "claude-mem",
        prompt: "[memory orchestrator]",
      }),
    })
    if (!initResponse.ok) {
      throw new ClaudeMemHttpClientError(
        `Session init failed: ${initResponse.status}`,
        initResponse.status,
      )
    }

    const response = await this.fetchWithTimeout("/api/sessions/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentSessionId: request.session_id,
        tool_name: request.tool_name,
        tool_input: request.tool_input,
        tool_response: request.tool_response,
        cwd: request.cwd,
      }),
    })
    if (!response.ok) {
      throw new ClaudeMemHttpClientError(
        `Add observation failed: ${response.status}`,
        response.status,
      )
    }
  }

  private async fetchWithTimeout(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      return await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      })
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ClaudeMemHttpClientError(
          `Request to ${path} timed out after ${this.config.timeoutMs}ms`,
        )
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}
