import type { ReasoningCoreTransport, SendRequestOptions, TransportConfig } from "./transport-interface"
import type { JsonRpcRequest } from "./json-rpc-message"
import { ReasoningCoreInfrastructureError } from "./infrastructure-error"
import { isRecord, tryParseJson } from "./mcp-payload-extractor"

export interface HttpTransportConfig extends TransportConfig {
  endpoint: string
}

interface SessionState {
  sessionId: string | undefined
  nextId: number
}

const MCP_PROTOCOL_VERSION = "2025-03-26"
const DEFAULT_SESSION_KEY = "__default__"

export function createHttpTransport(config: HttpTransportConfig): ReasoningCoreTransport {
  const sessions = new Map<string, SessionState>()

  function getSessionState(sessionKey: string): SessionState {
    let state = sessions.get(sessionKey)
    if (!state) {
      state = { sessionId: undefined, nextId: 1 }
      sessions.set(sessionKey, state)
    }
    return state
  }

  async function ensureInitialized(state: SessionState): Promise<void> {
    if (state.sessionId) return
    await rawPost(
      state,
      {
        jsonrpc: "2.0",
        id: state.nextId++,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "idm", version: "1.0.0" },
        },
      },
      { captureSessionId: true },
    )
  }

  async function sendRequest(message: JsonRpcRequest, options?: SendRequestOptions): Promise<unknown> {
    const sessionKey = options?.sessionKey ?? DEFAULT_SESSION_KEY
    const state = getSessionState(sessionKey)
    await ensureInitialized(state)
    return await rawPost(state, { ...message, id: state.nextId++ }, { captureSessionId: false })
  }

  async function rawPost(
    state: SessionState,
    body: JsonRpcRequest,
    options: { captureSessionId: boolean },
  ): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    let response: Response
    try {
      response = await fetch(config.endpoint, {
        method: "POST",
        headers: buildHeaders(state.sessionId),
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timer)
      if (error instanceof Error && error.name === "AbortError") {
        throw new ReasoningCoreInfrastructureError("timeout", `reasoning-core HTTP timed out after ${config.timeoutMs}ms`)
      }
      throw new ReasoningCoreInfrastructureError("network", describeError(error), error)
    }
    clearTimeout(timer)

    if (options.captureSessionId) {
      const sid = response.headers.get("mcp-session-id") ?? response.headers.get("Mcp-Session-Id")
      if (sid) state.sessionId = sid
    }

    if (!response.ok) {
      throw new ReasoningCoreInfrastructureError(
        "rpc",
        `reasoning-core HTTP ${response.status} ${response.statusText}`,
      )
    }

    const text = await response.text()
    const payload = parseHttpPayload(text)
    throwIfRpcErrorEnvelope(payload)
    return payload
  }

  function disposeSession(sessionKey: string): void {
    sessions.delete(sessionKey)
  }

  function dispose(): void {
    sessions.clear()
  }

  return { sendRequest, dispose, disposeSession }
}

function buildHeaders(sessionId: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  }
  if (sessionId) headers["Mcp-Session-Id"] = sessionId
  return headers
}

function parseHttpPayload(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new ReasoningCoreInfrastructureError("empty", "reasoning-core HTTP returned empty body")
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = tryParseJson(trimmed)
    if (parsed == null) {
      throw new ReasoningCoreInfrastructureError("invalid_json", `reasoning-core HTTP returned invalid JSON: ${trimmed.slice(0, 200)}`)
    }
    return parsed
  }

  const eventData = extractLastSseData(trimmed)
  if (eventData != null) {
    const parsed = tryParseJson(eventData)
    if (parsed == null) {
      throw new ReasoningCoreInfrastructureError("invalid_json", `reasoning-core SSE data is not JSON: ${eventData.slice(0, 200)}`)
    }
    return parsed
  }

  throw new ReasoningCoreInfrastructureError("invalid_json", `reasoning-core HTTP returned non-JSON body: ${trimmed.slice(0, 200)}`)
}

function extractLastSseData(text: string): string | undefined {
  const events = text.split(/\n\n+/)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    const lines = event.split("\n")
    const dataLine = lines.find((line) => line.startsWith("data:"))
    if (dataLine) {
      return dataLine.slice("data:".length).trim()
    }
  }
  return undefined
}

function throwIfRpcErrorEnvelope(payload: unknown): void {
  if (!isRecord(payload)) return
  if (!isRecord(payload.error)) return
  const errRec = payload.error
  const code = typeof errRec.code === "number" ? errRec.code : undefined
  const message = typeof errRec.message === "string" ? errRec.message : "unknown error"
  const reason = code == null ? message : `${code}: ${message}`
  throw new ReasoningCoreInfrastructureError("rpc", `reasoning-core HTTP RPC error: ${reason}`)
}

export async function probeHttpHealth(endpoint: string, timeoutMs: number): Promise<boolean> {
  const healthUrl = toHealthUrl(endpoint)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(healthUrl, { method: "GET", signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) return false
    const body = await response.json().catch(() => undefined)
    return isRecord(body) && body.healthy === true
  } catch {
    clearTimeout(timer)
    return false
  }
}

function toHealthUrl(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    url.pathname = "/health"
    url.search = ""
    return url.toString()
  } catch {
    return endpoint
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
