import type { EngineDriver, ReplayResult } from "./replay-engine-dispatcher"
import type { BrowserPool, PooledSession } from "../../mcp/idm-browser/pool"

let pool: BrowserPool | null = null

async function ensurePool(): Promise<BrowserPool> {
  if (pool) return pool
  const { createBrowserPool } = await import("../../mcp/idm-browser/pool")
  pool = createBrowserPool({
    maxConcurrent: 3,
    idleTimeoutMs: 120_000,
    engineOptions: { engine: "camoufox", headless: true },
  })
  return pool
}

function isAllowedMethod(m: string): m is "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" {
  return m === "GET" || m === "POST" || m === "PUT" || m === "DELETE" || m === "PATCH" || m === "HEAD"
}

export function createCamoufoxDriver(): EngineDriver {
  return async (req) => {
    const started = performance.now()
    const browserPool = await ensurePool()
    const session: PooledSession = await browserPool.acquire()
    try {
      const method = req.method.toUpperCase()
      if (!isAllowedMethod(method)) throw new Error(`camoufox driver: unsupported HTTP method '${req.method}'`)
      const apiRes = await session.context.request.fetch(req.url, {
        method,
        headers: req.headers,
        data: req.body ?? undefined,
      })
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(apiRes.headers())) headers[k] = v
      const body = await apiRes.text()
      const result: ReplayResult = {
        status: apiRes.status(),
        headers,
        body,
        timing_ms: Math.round(performance.now() - started),
      }
      return result
    } finally {
      await browserPool.release(session.id).catch(() => undefined)
    }
  }
}

export async function shutdownCamoufoxDriver(): Promise<void> {
  if (pool) {
    await pool.shutdown()
    pool = null
  }
}

export function __resetCamoufoxDriverPoolForTest(): void {
  pool = null
}
