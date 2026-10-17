import { execFile } from "node:child_process"

export type GitHubEnvelope<T> = { data?: T; errors?: { type?: string; message?: string; path?: (string | number)[] }[] }
type Budget = { remaining: number; resetAt: number; cost: number }
type CachedResponse = { etag: string; value: unknown }
type TransportOptions = { host?: string; env?: NodeJS.ProcessEnv; fetch?: typeof fetch; now?: () => number; authToken?: (host: string) => Promise<string> }

/** A deferred read is not a failure and must not advance a watch's unreadability timer. */
export class GitHubReadDeferred extends Error {
  constructor(readonly retryAt: number) { super("GitHub reads deferred until rate-limit reset") }
}

function cliToken(host: string): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  execFile("gh", ["auth", "token", "--hostname", host], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
    if (error || !stdout.trim()) reject(new Error("GitHub authentication unavailable"))
    else resolve(stdout.trim())
  })
  return promise
}

/** One transport per server/host, shared by fingerprint, detail, activity and REST reads. */
export class GitHubReadTransport {
  readonly host: string
  readonly #base: string
  readonly #cloud: boolean
  readonly #env: NodeJS.ProcessEnv
  readonly #fetch: typeof fetch
  readonly #now: () => number
  readonly #authToken: (host: string) => Promise<string>
  readonly #budgets = new Map<string, Budget>()
  readonly #cache = new Map<string, CachedResponse>()
  #token?: Promise<string>
  #tokenExpiresAt = 0
  #deferredUntil = 0
  #queue: Promise<unknown> = Promise.resolve()

  constructor(options: TransportOptions = {}) {
    this.#env = options.env ?? process.env
    this.host = options.host ?? this.#env.GH_HOST ?? "github.com"
    if (!/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(this.host)) throw new Error("Invalid GitHub host")
    this.#cloud = this.host === "github.com" || this.host.endsWith(".ghe.com")
    this.#base = this.host === "github.com" ? "https://api.github.com" : this.#cloud ? `https://api.${this.host}` : `https://${this.host}/api`
    this.#fetch = options.fetch ?? fetch
    this.#now = options.now ?? Date.now
    this.#authToken = options.authToken ?? cliToken
  }

  async rest<T>(path: string): Promise<T> {
    if (!/^\/[a-zA-Z0-9_/?=&.%-]+$/.test(path) || path.includes("..") || path.startsWith("//")) throw new Error("Invalid GitHub REST path")
    const prefix = this.#cloud ? "" : "/v3"
    return this.#enqueue(() => this.#request<T>(`${this.#base}${prefix}${path}`, "core"))
  }

  async graphql<T>(query: string): Promise<GitHubEnvelope<T>> {
    return this.#enqueue(() => this.#request<GitHubEnvelope<T>>(`${this.#base}/graphql`, "graphql", query))
  }

  #enqueue<T>(read: () => Promise<T>): Promise<T> {
    const result = this.#queue.catch(() => undefined).then(read)
    this.#queue = result
    return result
  }

  async #request<T>(url: string, resource: string, query?: string): Promise<T> {
    const now = this.#now(), budget = this.#budgets.get(resource)
    if (this.#deferredUntil > now) throw new GitHubReadDeferred(this.#deferredUntil)
    if (budget && budget.remaining < Math.max(1, budget.cost) && budget.resetAt > now) throw new GitHubReadDeferred(budget.resetAt)
    if (!this.#token || this.#tokenExpiresAt <= now) {
      // Do not reuse conditional-response bodies across credential refreshes.
      this.#cache.clear()
      this.#tokenExpiresAt = now + 5 * 60_000
      const token = this.#cloud
        ? this.#env.GH_TOKEN?.trim() || this.#env.GITHUB_TOKEN?.trim()
        : this.#env.GH_ENTERPRISE_TOKEN?.trim() || this.#env.GITHUB_ENTERPRISE_TOKEN?.trim()
      this.#token = token ? Promise.resolve(token) : this.#authToken(this.host)
      // An unavailable credential may be repaired while the server remains alive.
      void this.#token.catch(() => { this.#token = undefined; this.#tokenExpiresAt = 0 })
    }
    const headers = new Headers({ Accept: "application/vnd.github+json", Authorization: `Bearer ${await this.#token}`, "X-GitHub-Api-Version": "2022-11-28" })
    const cached = query === undefined ? this.#cache.get(url) : undefined
    if (cached) headers.set("If-None-Match", cached.etag)
    if (query !== undefined) headers.set("Content-Type", "application/json")
    let response: Response
    try {
      response = await this.#fetch(url, { method: query === undefined ? "GET" : "POST", headers, body: query === undefined ? undefined : JSON.stringify({ query }), signal: AbortSignal.timeout(30_000), redirect: "error" })
    } catch { throw new Error("GitHub transport read failed") }
    if (response.status === 401) {
      this.#token = undefined
      this.#tokenExpiresAt = 0
      this.#cache.clear()
    }
    const remaining = Number(response.headers.get("x-ratelimit-remaining")), resetAt = Number(response.headers.get("x-ratelimit-reset")) * 1000
    if (response.headers.has("x-ratelimit-remaining") && Number.isFinite(remaining) && Number.isFinite(resetAt)) this.#budgets.set(resource, { remaining, resetAt, cost: 1 })
    if (response.status === 304 && cached) return structuredClone(cached.value) as T
    // Do not echo raw response bodies: they may contain private repository data or credentials.
    const reader = response.body?.getReader(), decoder = new TextDecoder()
    let text = "", bytes = 0
    if (reader) {
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("GitHub response exceeds read limit") }
          text += decoder.decode(chunk.value, { stream: true })
        }
        text += decoder.decode()
      } finally { reader.releaseLock() }
    }
    let value: unknown
    try { value = JSON.parse(text) } catch { throw new Error(`GitHub returned unreadable JSON (${response.status})`) }
    const object = value && typeof value === "object" ? value as Record<string, unknown> : {}
    const rate = (object.data as { rateLimit?: { remaining?: number; resetAt?: string; cost?: number } } | undefined)?.rateLimit
    if (rate && typeof rate.remaining === "number" && typeof rate.resetAt === "string" && Number.isFinite(Date.parse(rate.resetAt))) this.#budgets.set("graphql", { remaining: rate.remaining, resetAt: Date.parse(rate.resetAt), cost: Math.max(1, rate.cost ?? 1) })
    const retry = response.headers.get("retry-after")
    const seconds = retry === null ? NaN : Number(retry)
    const retryAt = retry === null ? NaN : Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(retry)
    const errors = Array.isArray(object.errors) ? object.errors as { type?: string }[] : []
    const primaryExhausted = response.headers.has("x-ratelimit-remaining") && remaining === 0
    if (response.status === 429 || (response.status === 403 && (retry !== null || /secondary rate limit|abuse detection/i.test(String(object.message ?? ""))))) {
      const deadline = Number.isFinite(retryAt) ? Math.max(now, retryAt) : now + 60_000
      this.#deferredUntil = Math.max(this.#deferredUntil, deadline)
      throw new GitHubReadDeferred(this.#deferredUntil)
    }
    if ((response.status === 403 && primaryExhausted) || errors.some(error => error.type === "RATE_LIMITED")) {
      const known = this.#budgets.get(resource)
      const deadline = known && known.resetAt > now ? known.resetAt : now + 60_000
      this.#budgets.set(resource, { remaining: 0, resetAt: deadline, cost: 1 })
      throw new GitHubReadDeferred(deadline)
    }
    if (!response.ok) throw new Error(`GitHub read failed (${response.status})`)
    const etag = response.headers.get("etag")
    if (query === undefined && etag) {
      if (this.#cache.size >= 256 && !this.#cache.has(url)) this.#cache.delete(this.#cache.keys().next().value!)
      this.#cache.set(url, { etag, value: structuredClone(value) })
    }
    return value as T
  }
}

const transports = new Map<string, GitHubReadTransport>()
export function sharedGitHubReadTransport(host = process.env.GH_HOST ?? "github.com"): GitHubReadTransport {
  let transport = transports.get(host)
  if (!transport) { transport = new GitHubReadTransport({ host }); transports.set(host, transport) }
  return transport
}
