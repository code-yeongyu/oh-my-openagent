import type { BrowserContext, BrowserContextOptions, Page } from "playwright-core"
import type { EngineInstance, EngineProxy } from "../engines"
import { dispatchEngine, type EngineDispatchOptions } from "../engines"
import { createNetworkTap, type NetworkTap } from "../observation/network-tap"

export type PooledSession = {
  id: string
  context: BrowserContext
  page: Page
  tap: NetworkTap
  createdAt: number
  lastActivityAt: number
  recordingDir?: string
  proxy?: EngineProxy
}

export type SessionInfo = {
  id: string
  url: string
  title: string
  createdAt: number
  lastActivityAt: number
  ageMs: number
  idleMs: number
}

export type ContextDecorator = (context: BrowserContext) => Promise<void> | void

export type BrowserPoolConfig = {
  maxConcurrent: number
  idleTimeoutMs: number
  engineOptions?: EngineDispatchOptions
  engineMaxAgeMs?: number
  engineOptionsFactory?: () => Promise<EngineDispatchOptions> | EngineDispatchOptions
  contextOptions?: BrowserContextOptions
  contextDecorator?: ContextDecorator
  now?: () => number
}

const DEFAULT_POOL_CONFIG: BrowserPoolConfig = {
  maxConcurrent: 5,
  idleTimeoutMs: 300_000,
}

export function createBrowserPool(config: Partial<BrowserPoolConfig> = {}) {
  const poolConfig = { ...DEFAULT_POOL_CONFIG, ...config }
  const now = poolConfig.now ?? (() => Date.now())
  const sessions = new Map<string, PooledSession>()
  let engine: EngineInstance | null = null
  let engineCreatedAt: number | null = null
  let idleTimer: ReturnType<typeof setInterval> | null = null
  let currentEngineOverride: string | null = null

  async function resolveEngineOptions(): Promise<EngineDispatchOptions | undefined> {
    if (poolConfig.engineOptionsFactory) {
      const opts = await poolConfig.engineOptionsFactory()
      if (currentEngineOverride) {
        return { ...opts, engine: currentEngineOverride as EngineDispatchOptions["engine"] }
      }
      return opts
    }
    if (currentEngineOverride) {
      return { engine: currentEngineOverride as EngineDispatchOptions["engine"] }
    }
    return poolConfig.engineOptions
  }

  function isEngineExpired(): boolean {
    if (!engine || engineCreatedAt === null) return false
    const maxAge = poolConfig.engineMaxAgeMs
    if (!maxAge || !Number.isFinite(maxAge)) return false
    return now() - engineCreatedAt > maxAge
  }

  async function ensureEngine(): Promise<EngineInstance> {
    if (engine && isEngineExpired()) {
      for (const [id, session] of sessions) {
        await session.context.close().catch(() => {})
        sessions.delete(id)
      }
      await resetEngine()
    }
    if (!engine) {
      engine = await dispatchEngine(await resolveEngineOptions())
      engineCreatedAt = now()
      startIdleSweep()
    }
    return engine
  }

  function startIdleSweep() {
    if (idleTimer) return
    idleTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, session] of sessions) {
        if (now - session.lastActivityAt > poolConfig.idleTimeoutMs) {
          session.context.close().catch(() => {})
          sessions.delete(id)
        }
      }
    }, 30_000)
  }

  function generateSessionId(): string {
    return `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  async function tryAcquireOnce(sessionId: string | undefined, recordingDir?: string): Promise<PooledSession> {
    const eng = await ensureEngine()
    const context = poolConfig.contextOptions
      ? await eng.browser.newContext(poolConfig.contextOptions)
      : await eng.browser.newContext()
    if (poolConfig.contextDecorator) {
      await poolConfig.contextDecorator(context)
    }
    const page = await context.newPage()
    const tap = createNetworkTap(page)
    tap.start()
    const id = sessionId ?? generateSessionId()
    const now = Date.now()
    const session: PooledSession = { id, context, page, tap, createdAt: now, lastActivityAt: now, recordingDir, proxy: eng.proxy }
    sessions.set(id, session)
    return session
  }

  async function resetEngine(): Promise<void> {
    if (engine) {
      try { await engine.close() } catch { void 0 }
      engine = null
      engineCreatedAt = null
    }
  }

  async function acquire(sessionId?: string, recordingDir?: string): Promise<PooledSession> {
    if (sessionId && sessions.has(sessionId)) {
      const existing = sessions.get(sessionId)!
      existing.lastActivityAt = Date.now()
      return existing
    }

    if (sessions.size >= poolConfig.maxConcurrent) {
      throw new Error(`Pool limit reached (${poolConfig.maxConcurrent} concurrent contexts)`)
    }

    try {
      return await tryAcquireOnce(sessionId, recordingDir)
    } catch (err) {
      await resetEngine()
      try {
        return await tryAcquireOnce(sessionId, recordingDir)
      } catch (retryErr) {
        const original = err instanceof Error ? err.message : String(err)
        const retry = retryErr instanceof Error ? retryErr.message : String(retryErr)
        throw new Error(`acquire failed after engine reset. original=${original} retry=${retry}`)
      }
    }
  }

  async function release(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) return
    await session.context.close().catch(() => {})
    sessions.delete(sessionId)
  }

  function getSession(sessionId: string): PooledSession | undefined {
    return sessions.get(sessionId)
  }

  function switchEngine(engineName: string): void {
    if (currentEngineOverride === engineName && engine) return
    for (const [id] of sessions) {
      const s = sessions.get(id)
      if (s) s.context.close().catch(() => {})
      sessions.delete(id)
    }
    if (engine) {
      engine.close().catch(() => {})
      engine = null
      engineCreatedAt = null
    }
    currentEngineOverride = engineName
  }

  async function shutdown(): Promise<void> {
    if (idleTimer) {
      clearInterval(idleTimer)
      idleTimer = null
    }
    for (const [id, session] of sessions) {
      await session.context.close().catch(() => {})
      sessions.delete(id)
    }
    if (engine) {
      await engine.close()
      engine = null
      engineCreatedAt = null
    }
  }

  function getSessionCount(): number {
    return sessions.size
  }

  function hasSession(sessionId: string): boolean {
    return sessions.has(sessionId)
  }

  async function listSessions(): Promise<SessionInfo[]> {
    const now = Date.now()
    const result: SessionInfo[] = []
    for (const session of sessions.values()) {
      let url = ""
      let title = ""
      try {
        url = session.page.url()
      } catch {
        url = "<unavailable>"
      }
      try {
        title = await session.page.title()
      } catch {
        title = "<unavailable>"
      }
      result.push({
        id: session.id,
        url,
        title,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        ageMs: now - session.createdAt,
        idleMs: now - session.lastActivityAt,
      })
    }
    return result
  }

  return { acquire, release, shutdown, switchEngine, getSessionCount, hasSession, listSessions, getSession }
}

export type BrowserPool = ReturnType<typeof createBrowserPool>
