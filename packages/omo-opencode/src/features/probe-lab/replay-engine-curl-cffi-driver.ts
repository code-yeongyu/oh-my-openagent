import type { EngineDriver, ReplayResult } from "./replay-engine-dispatcher"

export const CHROME_146_JA3 = "771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0"
export const CHROME_146_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"

type CycleTLSClient = {
  (url: string, options: Record<string, unknown>, method: string): Promise<{ status: number; headers: Record<string, unknown>; data: unknown; finalUrl: string }>
  exit: () => Promise<unknown>
}

let cycleTLS: CycleTLSClient | null = null
let initPromise: Promise<CycleTLSClient> | null = null

async function ensureCycleTLS(): Promise<CycleTLSClient> {
  if (cycleTLS) return cycleTLS
  if (initPromise) return initPromise
  initPromise = (async () => {
    const moduleName = "cycletls"
    let mod: { default?: (opts?: Record<string, unknown>) => Promise<CycleTLSClient> }
    try {
      mod = (await import(moduleName)) as { default?: (opts?: Record<string, unknown>) => Promise<CycleTLSClient> }
    } catch (err) {
      throw new Error(`curl_cffi driver: 'cycletls' module not found. Install as peer dep: bun add cycletls. Underlying: ${err instanceof Error ? err.message : String(err)}`)
    }
    const init = mod.default ?? (mod as unknown as (opts?: Record<string, unknown>) => Promise<CycleTLSClient>)
    if (typeof init !== "function") throw new Error("curl_cffi driver: cycletls module did not export an initializer function")
    const port = 30000 + Math.floor(Math.random() * 5000)
    cycleTLS = await init({ port, timeout: 30_000 })
    return cycleTLS
  })()
  return initPromise
}

function bodyToString(data: unknown): string {
  if (typeof data === "string") return data
  if (data == null) return ""
  if (data instanceof Uint8Array) return new TextDecoder("utf-8").decode(data)
  return JSON.stringify(data)
}

function flattenHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) out[k] = v.map(String).join(", ")
    else if (v != null) out[k] = String(v)
  }
  return out
}

export function createCurlCffiDriver(opts?: { ja3?: string; userAgent?: string }): EngineDriver {
  const ja3 = opts?.ja3 ?? CHROME_146_JA3
  const userAgent = opts?.userAgent ?? CHROME_146_USER_AGENT
  return async (req) => {
    const started = performance.now()
    const cycle = await ensureCycleTLS()
    const method = req.method.toLowerCase()
    if (req.body instanceof Uint8Array) {
      throw new Error("curl_cffi engine does not support binary request bodies; route binary uploads through a proxy-aware curl path or bun fetch")
    }
    const cycleOpts: Record<string, unknown> = {
      ja3,
      userAgent,
      headers: req.headers,
      body: req.body ?? undefined,
      timeout: 30,
    }
    if (req.proxy) cycleOpts.proxy = req.proxy
    const res = await cycle(req.url, cycleOpts, method)
    const result: ReplayResult = {
      status: res.status,
      headers: flattenHeaders(res.headers),
      body: bodyToString(res.data),
      timing_ms: Math.round(performance.now() - started),
    }
    return result
  }
}

export async function shutdownCurlCffiDriver(): Promise<void> {
  if (cycleTLS) {
    await cycleTLS.exit().catch(() => undefined)
    cycleTLS = null
    initPromise = null
  }
}

export function __resetCurlCffiDriverForTest(): void {
  cycleTLS = null
  initPromise = null
}
