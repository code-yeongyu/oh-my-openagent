import { log } from "../../shared"

const GITNEXUS_API_VERSION = "v1"

export interface GitNexusClientOptions {
  serverUrl: string
  apiKey?: string
  timeoutMs: number
}

export interface RepoInfo {
  name: string
  path: string
  indexedAt: string
  lastCommit: string
  remoteUrl: string
  stats: {
    files: number
    nodes: number
    edges: number
    communities: number
    processes: number
    embeddings: number
  }
}

export interface QueryResult {
  processes?: Array<{
    heuristicLabel: string
    stepCount: number
    communities: string[]
  }>
  process_symbols?: Array<{
    name: string
    filePath: string
    kind: string
    module: string
  }>
  definitions?: Array<{
    name: string
    filePath: string
    kind: string
  }>
}

export interface CypherResult {
  markdown: string
  row_count: number
}

export interface ContextResult {
  markdown: string
  name?: string
  kind?: string
  filePath?: string
  incoming?: Array<{ name: string; filePath: string; kind: string; relationType: string }>
  outgoing?: Array<{ name: string; filePath: string; kind: string; relationType: string }>
}

export interface ImpactResult {
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  summary: string
  byDepth: Record<number, Array<{ name: string; filePath: string; kind: string }>>
  affected_processes?: Array<{ heuristicLabel: string; step: number }>
}

export interface RouteMapResult {
  routes: Array<{
    path: string
    handler: string
    consumers: Array<{ name: string; filePath: string }>
  }>
}

export class GitNexusClient {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly timeoutMs: number

  constructor(options: GitNexusClientOptions) {
    this.baseUrl = `${options.serverUrl.replace(/\/+$/, "")}/api/${GITNEXUS_API_VERSION}`
    this.apiKey = options.apiKey
    this.timeoutMs = options.timeoutMs
  }

  private async request<T>(path: string, params?: Record<string, string | undefined>): Promise<T | null> {
    const url = new URL(`${this.baseUrl}${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value)
      }
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(url.toString(), { headers, signal: controller.signal })
      if (!response.ok) {
        log("[gitnexus] API error", { status: response.status, path })
        return null
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        log("[gitnexus] request timed out", { path, timeoutMs: this.timeoutMs })
      } else {
        log("[gitnexus] request failed", { path, error: String(error) })
      }
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async postRequest<T>(path: string, body: unknown): Promise<T | null> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        log("[gitnexus] API error", { status: response.status, path })
        return null
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        log("[gitnexus] request timed out", { path, timeoutMs: this.timeoutMs })
      } else {
        log("[gitnexus] request failed", { path, error: String(error) })
      }
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /** List all indexed repositories. */
  async listRepos(): Promise<RepoInfo[] | null> {
    return this.request<RepoInfo[]>("/repos")
  }

  /** Query the knowledge graph by natural language. */
  async query(params: {
    query: string
    repo?: string
    task_context?: string
    goal?: string
    limit?: number
  }): Promise<QueryResult | null> {
    return this.postRequest<QueryResult>("/query", params)
  }

  /** Execute a raw Cypher query against the knowledge graph. */
  async cypher(params: { query: string; repo?: string }): Promise<CypherResult | null> {
    return this.postRequest<CypherResult>("/cypher", params)
  }

  /** Get 360-degree context for a symbol. */
  async context(params: {
    name: string
    repo?: string
    file_path?: string
    kind?: string
    include_content?: boolean
  }): Promise<ContextResult | null> {
    return this.postRequest<ContextResult>("/context", params)
  }

  /** Analyze blast radius of changing a symbol. */
  async impact(params: {
    target: string
    direction: "upstream" | "downstream"
    repo?: string
    file_path?: string
    kind?: string
    maxDepth?: number
  }): Promise<ImpactResult | null> {
    return this.postRequest<ImpactResult>("/impact", params)
  }

  /** Get API route mappings. */
  async routeMap(params: { route?: string; repo?: string }): Promise<RouteMapResult | null> {
    const queryParams: Record<string, string> = {}
    if (params.route) queryParams.route = params.route
    if (params.repo) queryParams.repo = params.repo
    return this.request<RouteMapResult>("/routes", queryParams)
  }

  /** Health check — returns true if the server is reachable. */
  async healthCheck(): Promise<boolean> {
    const result = await this.request<{ status: string }>("/health")
    return result !== null
  }
}
