import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { join } from "node:path"
import { homedir } from "node:os"
import type { BrowserAutomationConfig } from "../../../config/schema/browser-automation"
import { createBrowserPool, type BrowserPool } from "../pool"
import { createActionCache, type ActionCache } from "../primitives"
import { silenceConsoleToFile, appendServerLog } from "./console-silencer"
import { buildEngineProxy } from "./engine-proxy-builder"
import { registerBrowserTools } from "./tool-registrations"

const LOG_PATH = join(homedir(), "Library", "Caches", "idm", "browser", "server.log")

export async function startBrowserServer(
  port: number,
  config?: BrowserAutomationConfig,
): Promise<() => Promise<void>> {
  silenceConsoleToFile(LOG_PATH)
  appendServerLog(LOG_PATH, "diag", {
    stage: "startBrowserServer:entry",
    port,
    hasConfig: !!config,
    engine: config?.engine,
    hasProxy: !!config?.proxy,
    proxyProvider: config?.proxy?.provider,
    proxyEndpoint: config?.proxy?.endpoint,
    proxyCredentialsRef: config?.proxy?.credentials,
  })

  let pool: BrowserPool | null = null
  let cache: ActionCache | null = null

  async function ensurePool(): Promise<BrowserPool> {
    if (pool) return pool
    let initialProxy: Awaited<ReturnType<typeof buildEngineProxy>> = undefined
    let proxyError: string | undefined
    if (config) {
      try {
        initialProxy = await buildEngineProxy(config)
      } catch (err) {
        proxyError = err instanceof Error ? err.message : String(err)
      }
    }
    const initialProxyServer = typeof initialProxy === "string" ? initialProxy : initialProxy?.server
    const initialHasUsername = typeof initialProxy === "object" && initialProxy !== null ? !!initialProxy.username : false
    const initialHasPassword = typeof initialProxy === "object" && initialProxy !== null ? !!initialProxy.password : false
    const stickyDurationMin = config?.proxy?.session?.mode === "sticky"
      ? (config.proxy.session.duration_minutes ?? 10)
      : null
    const engineMaxAgeMs = stickyDurationMin
      ? Math.max(60_000, (stickyDurationMin - 1) * 60_000)
      : Number.POSITIVE_INFINITY
    appendServerLog(LOG_PATH, "diag", {
      stage: "ensurePool:firstCall",
      proxyResolved: !!initialProxy,
      proxyServer: initialProxyServer,
      proxyHasUsername: initialHasUsername,
      proxyHasPassword: initialHasPassword,
      proxyError,
      poolMaxConcurrent: config?.pool?.max_concurrent_contexts ?? 5,
      engineMaxAgeMs: Number.isFinite(engineMaxAgeMs) ? engineMaxAgeMs : "Infinity",
      stickyDurationMin,
    })
    pool = createBrowserPool({
      maxConcurrent: config?.pool?.max_concurrent_contexts ?? 5,
      idleTimeoutMs: config?.pool?.context_idle_timeout_ms ?? 300_000,
      engineMaxAgeMs,
      engineOptionsFactory: async () => {
        const freshProxy = config ? await buildEngineProxy(config) : undefined
        appendServerLog(LOG_PATH, "diag", {
          stage: "engineOptionsFactory:invoked",
          hasProxy: !!freshProxy,
          proxyServer: typeof freshProxy === "string" ? freshProxy : freshProxy?.server,
        })
        return {
          engine: config?.engine ?? "camoufox",
          proxy: freshProxy,
          humanize: true,
          headless: config?.headless ?? true,
          locale: "it-IT",
          os: ["windows", "macos"],
        }
      },
    })
    return pool
  }

  function ensureCache(): ActionCache {
    if (!cache) cache = createActionCache()
    return cache
  }

  function buildMcpServer(): McpServer {
    const mcp = new McpServer({ name: "idm-browser", version: "0.2.0" })
    registerBrowserTools(mcp, { getPool: ensurePool, getCache: ensureCache })
    return mcp
  }

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    error(err) {
      appendServerLog(LOG_PATH, "serve-error", { message: err.message, stack: err.stack })
      return new Response("Internal error", { status: 500 })
    },
    async fetch(req) {
      try {
        const url = new URL(req.url)
        if (url.pathname === "/health") {
          return new Response(JSON.stringify({ ok: true, port }), {
            headers: { "Content-Type": "application/json" },
          })
        }
        if (url.pathname === "/mcp") {
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          })
          const mcp = buildMcpServer()
          await mcp.connect(transport)
          return await transport.handleRequest(req)
        }
        return new Response("Not found", { status: 404 })
      } catch (err) {
        appendServerLog(LOG_PATH, "fetch-error", {
          message: (err as Error).message,
          stack: (err as Error).stack,
          url: req.url,
        })
        return new Response("Internal error", { status: 500 })
      }
    },
  })

  return async () => {
    server.stop(true)
    if (pool) await pool.shutdown()
    if (cache) cache.close()
  }
}
