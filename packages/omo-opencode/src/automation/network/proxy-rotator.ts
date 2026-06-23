export type ProxyConfig = {
  server: string
  username?: string
  password?: string
  label?: string
}

export type RotatorStrategy = "cyclic" | "random" | "sticky-by-host"

export type RotatorOptions = {
  proxies: ProxyConfig[]
  strategy?: RotatorStrategy
  blockedTtlMs?: number
}

export type BlockedProxyReason = "rate_limit" | "fingerprint_burned" | "silent_rejection"

export type RotatorStats = {
  total: number
  healthy: number
  bad: number
}

type ProxyEntry = {
  proxy: ProxyConfig
  bad: boolean
  reason?: string
  failedAt?: number
  blockedUntil?: number
}

export class ProxyRotator {
  private readonly entries: ProxyEntry[]
  private readonly strategy: RotatorStrategy
  private cyclicIndex = 0
  private readonly blockedTtlMs: number
  private readonly stickyByHost = new Map<string, ProxyConfig>()

  constructor(opts: RotatorOptions) {
    if (!Array.isArray(opts.proxies) || opts.proxies.length === 0) {
      throw new Error("ProxyRotator requires at least one proxy entry")
    }
    this.entries = opts.proxies.map((p) => ({ proxy: p, bad: false }))
    this.strategy = opts.strategy ?? "cyclic"
    this.blockedTtlMs = opts.blockedTtlMs ?? 30 * 60 * 1000
  }

  next(host?: string): ProxyConfig {
    this.cleanupExpiredBlocks()
    const healthy = this.healthy()
    if (healthy.length === 0) {
      throw new Error("ProxyRotator: no healthy proxies available")
    }

    if (this.strategy === "sticky-by-host" && host) {
      const cached = this.stickyByHost.get(host)
      if (cached && healthy.includes(cached)) return cached
      const picked = this.pickRandom(healthy)
      this.stickyByHost.set(host, picked)
      return picked
    }

    if (this.strategy === "random") {
      return this.pickRandom(healthy)
    }

    const picked = healthy[this.cyclicIndex % healthy.length]!
    this.cyclicIndex = (this.cyclicIndex + 1) % healthy.length
    return picked
  }

  markBad(proxy: ProxyConfig, reason?: string): void {
    const entry = this.entries.find((e) => proxyKey(e.proxy) === proxyKey(proxy))
    if (!entry) return
    entry.bad = true
    entry.reason = reason
    entry.failedAt = Date.now()
    for (const [host, cached] of this.stickyByHost) {
      if (proxyKey(cached) === proxyKey(proxy)) {
        this.stickyByHost.delete(host)
      }
    }
  }

  markBlocked(proxy: ProxyConfig, reason: BlockedProxyReason): void {
    const entry = this.entries.find((e) => proxyKey(e.proxy) === proxyKey(proxy))
    if (!entry) return
    this.markBad(proxy, reason)
    entry.blockedUntil = Date.now() + this.blockedTtlMs
  }

  markHealthy(proxy: ProxyConfig): void {
    const entry = this.entries.find((e) => proxyKey(e.proxy) === proxyKey(proxy))
    if (!entry) return
    entry.bad = false
    entry.reason = undefined
    entry.failedAt = undefined
    entry.blockedUntil = undefined
  }

  healthy(): ProxyConfig[] {
    this.cleanupExpiredBlocks()
    return this.entries.filter((e) => !e.bad).map((e) => e.proxy)
  }

  bad(): Array<{ proxy: ProxyConfig; reason?: string; failedAt?: number }> {
    return this.entries
      .filter((e) => e.bad)
      .map((e) => ({ proxy: e.proxy, reason: e.reason, failedAt: e.failedAt }))
  }

  stats(): RotatorStats {
    const total = this.entries.length
    const bad = this.entries.filter((e) => e.bad).length
    return { total, healthy: total - bad, bad }
  }

  private pickRandom(pool: ProxyConfig[]): ProxyConfig {
    const idx = Math.floor(Math.random() * pool.length)
    return pool[idx]!
  }

  cleanupExpiredBlocks(): void {
    const now = Date.now()
    for (const entry of this.entries) {
      if (entry.blockedUntil !== undefined && entry.blockedUntil <= now) {
        entry.bad = false
        entry.reason = undefined
        entry.failedAt = undefined
        entry.blockedUntil = undefined
      }
    }
  }
}

function proxyKey(p: ProxyConfig): string {
  return `${p.server}|${p.username ?? ""}`
}
