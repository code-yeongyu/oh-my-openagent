import { findAvailablePort } from "../../../shared/port-utils"
import { log } from "../../../shared/logger"
import type { AccountPool } from "./account-pool"
import { checkBearerAuth } from "./auth"
import type { OpenAICompatConfig } from "./config-schema"
import { internalError, notFound, unauthorized } from "./errors"
import { extractOrGenerateRequestId } from "./request-id"
import { handleCompletions } from "./routes/completions"
import { handleHealth } from "./routes/health"
import { handleModels } from "./routes/models"
import { drainSessionDeletes } from "./session-cleanup"

const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000

export type OpenAICompatServer = {
  url: string
  port: number
  host: string
  stop: () => Promise<void>
}

export type OpenAICompatServerDeps = {
  pool?: AccountPool
}

export async function createOpenAICompatServer(
  config: OpenAICompatConfig,
  deps?: OpenAICompatServerDeps,
): Promise<OpenAICompatServer> {
  const startedAt = Date.now()
  const port = await resolvePort(config.host, config.port)
  const injectedPool = deps?.pool ?? null

  const server = Bun.serve({
    hostname: config.host,
    port,
    fetch: (request) => dispatch(request, config, startedAt, injectedPool),
    error(err) {
      log(`openai-compat-server: serve error: ${err.message}`)
      return internalError()
    },
  })

  const boundPort = server.port ?? port
  const url = `http://${config.host}:${boundPort}`
  return {
    url,
    port: boundPort,
    host: config.host,
    async stop() {
      server.stop(true)
      const drain = await drainSessionDeletes(SHUTDOWN_DRAIN_TIMEOUT_MS)
      if (drain.pending_at_drain > 0) {
        log(
          `openai-compat-server: drain on stop pending=${drain.pending_at_drain} drained=${drain.drained} timed_out=${drain.timed_out}`,
        )
      }
    },
  }
}

async function dispatch(
  request: Request,
  config: OpenAICompatConfig,
  startedAt: number,
  injectedPool: AccountPool | null,
): Promise<Response> {
  const url = new URL(request.url)
  const requestId = extractOrGenerateRequestId(request)
  const start = Date.now()
  const response = await route(request, url, config, startedAt, requestId, injectedPool)
  log(
    `openai-compat-server: ${request.method} ${url.pathname} -> ${response.status} (${Date.now() - start}ms) [rid=${requestId}]`,
  )
  return response
}

async function route(
  request: Request,
  url: URL,
  config: OpenAICompatConfig,
  startedAt: number,
  requestId: string,
  injectedPool: AccountPool | null,
): Promise<Response> {
  if (url.pathname === "/health") {
    return handleHealth({ startedAt, version: config.version })
  }

  const auth = checkBearerAuth(request, config.bearer_token)
  if (!auth.ok) return unauthorized()

  if (url.pathname === "/v1/models" && request.method === "GET") {
    return handleModels({ startedAt })
  }
  if (url.pathname === "/v1/chat/completions") {
    return handleCompletions(
      request,
      injectedPool ? { requestId, pool: injectedPool } : { requestId },
    )
  }
  return notFound(url.pathname)
}

async function resolvePort(host: string, requested: number): Promise<number> {
  if (requested === 0) {
    return findAvailablePort(38_000, host)
  }
  return requested
}
