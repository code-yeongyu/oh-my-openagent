import type { BrowserAutomationConfig } from "../config/schema/browser-automation"
import { createBrowserPool, type BrowserPool, type SessionInfo } from "../mcp/idm-browser/pool"
import { installAdBlocker } from "../mcp/idm-browser/network/ad-blocker"
import {
  handleNavigate,
  handleFill,
  handleClick,
  handleEvaluate,
  handlePress,
  handleExtract,
  handleExtractNetwork,
  handleScreenshot,
  handleEndSession,
  handleObserve,
  handleSolveCaptcha,
} from "../mcp/idm-browser/server/handlers"
import type { FingerprintFamily } from "./fingerprint"
import type { InitScript } from "./init-scripts"
import { buildPoolConfigFromSession, setSessionFamily, clearSessionFamily } from "./fingerprint-binding"
import { dumpAuthForSession } from "./dump-auth"

export type FillDispatchMode = "fill" | "keyboard" | "native"
export type WaitUntil = "load" | "domcontentloaded" | "networkidle"

export type BrowserSessionOptions = {
  proxy?: BrowserAutomationConfig["proxy"]
  engine?: "camoufox" | "patchright" | "lightpanda" | "cloakbrowser"
  locale?: string
  humanize?: boolean
  poolMaxConcurrent?: number
  idleTimeoutMs?: number
  block_ads?: boolean
  family?: FingerprintFamily
  initScripts?: InitScript[]
}

type ToolResult = {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
}

function unwrapJson<T>(result: ToolResult): T {
  const text = result.content?.[0]?.text
  if (typeof text !== "string") {
    throw new Error("BrowserSession: handler returned no text content")
  }
  const parsed = JSON.parse(text) as T & { success?: boolean; error?: string }
  if (parsed.success === false) {
    throw new Error(`BrowserSession: ${parsed.error ?? "operation failed"}`)
  }
  return parsed
}

export class BrowserSession {
  readonly id: string
  private constructor(
    private readonly pool: BrowserPool,
    private readonly ownsPool: boolean,
    sessionId: string,
  ) {
    this.id = sessionId
  }

  static async create(opts: BrowserSessionOptions = {}): Promise<BrowserSession> {
    const pool = createBrowserPool(buildPoolConfigFromSession(opts))
    const session = await pool.acquire()
    if (opts.family) setSessionFamily(session.id, opts.family)
    if (opts.block_ads) {
      await installAdBlocker(session.context)
    }
    return new BrowserSession(pool, true, session.id)
  }

  static async fromExistingPool(pool: BrowserPool, sessionId?: string): Promise<BrowserSession> {
    const session = await pool.acquire(sessionId)
    return new BrowserSession(pool, false, session.id)
  }

  async navigate(url: string, opts?: { waitUntil?: WaitUntil }): Promise<{ url: string; title: string }> {
    const result = await handleNavigate(this.pool, { url, waitUntil: opts?.waitUntil, sessionId: this.id })
    return unwrapJson<{ sessionId: string; url: string; title: string }>(result)
  }

  async fill(selector: string, value: string, opts?: { dispatch?: FillDispatchMode; clear?: boolean; delayMs?: number }): Promise<void> {
    const result = await handleFill(this.pool, {
      selector,
      value,
      sessionId: this.id,
      dispatch: opts?.dispatch,
      clear: opts?.clear,
      delay_ms: opts?.delayMs,
    })
    unwrapJson(result)
  }

  async click(selector: string): Promise<void> {
    const result = await handleClick(this.pool, { selector, sessionId: this.id })
    unwrapJson(result)
  }

  async press(key: string, opts?: { selector?: string; modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift">; delayMs?: number }): Promise<void> {
    const result = await handlePress(this.pool, {
      key,
      selector: opts?.selector,
      modifiers: opts?.modifiers,
      delay_ms: opts?.delayMs,
      sessionId: this.id,
    })
    unwrapJson(result)
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await handleEvaluate(this.pool, { expression, sessionId: this.id })
    const parsed = unwrapJson<{ result: T }>(result)
    return parsed.result
  }

  async extract(opts?: { selector?: string; format?: "text" | "html" | "json"; attribute?: string }): Promise<{ content: string; wordCount?: number; url?: string; title?: string }> {
    const result = await handleExtract(this.pool, { ...opts, sessionId: this.id })
    return unwrapJson(result)
  }

  async extractNetwork(opts?: { filter?: "all" | "xhr" | "fetch" | "document"; clear?: boolean }): Promise<{ requests: Array<{ url: string; method: string; status?: number; resourceType: string; timestamp: number }>; count: number }> {
    const result = await handleExtractNetwork(this.pool, { ...opts, sessionId: this.id })
    return unwrapJson(result)
  }

  async observe(query?: string): Promise<unknown> {
    const result = await handleObserve(this.pool, { query, sessionId: this.id })
    return unwrapJson(result)
  }

  async solveCaptcha(): Promise<{ detected: boolean; solver?: string }> {
    const result = await handleSolveCaptcha(this.pool, { sessionId: this.id })
    return unwrapJson(result)
  }

  async screenshot(opts?: { selector?: string; fullPage?: boolean }): Promise<Buffer> {
    const result = await handleScreenshot(this.pool, {
      sessionId: this.id,
      selector: opts?.selector,
      fullPage: opts?.fullPage ?? false,
    })
    for (const item of result.content) {
      const data = "data" in item ? item.data : undefined
      if (typeof data === "string") {
        return Buffer.from(data, "base64")
      }
    }
    throw new Error("BrowserSession: screenshot returned no image data")
  }

  async listSessions(): Promise<SessionInfo[]> {
    return this.pool.listSessions()
  }

  async dumpAuth(origin: string): Promise<string> {
    return dumpAuthForSession(this.pool, this.id, origin)
  }

  async close(): Promise<void> {
    clearSessionFamily(this.id)
    await handleEndSession(this.pool, { sessionId: this.id }).catch(() => undefined)
    if (this.ownsPool) {
      await this.pool.shutdown().catch(() => undefined)
    }
  }
}
