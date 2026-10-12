import type { Plugin } from "@opencode/plugin"

import { log } from "../shared/logger"
import { getServerBasicAuthHeader } from "../shared/opencode-server-auth"
import { resolveServeOrigin } from "./serve-http"

type V2Context = Plugin.Context

/**
 * The V1 ask() payload (@opencode-ai/plugin ToolContext.ask) that OMO's skill
 * tool still speaks: a permission action plus resource patterns.
 */
export type V1AskInput = {
  permission: string
  patterns: string[]
  always?: string[]
  metadata?: Record<string, unknown>
}

/** The slices of a v2 tool execution context the bridge needs. */
export type BridgeToolContext = {
  sessionID: string
  agent?: string
  messageID?: string
  id?: string
  signal?: AbortSignal
}

export type PermissionBridgeDeps = {
  fetchImpl?: typeof fetch
  argv?: readonly string[]
  listenPort?: () => Promise<number | undefined>
  probeTimeoutMs?: number
  retryOriginAfterMs?: number
}

export class SkillPermissionDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SkillPermissionDeniedError"
  }
}

type CreateOutcome = { id: string; effect: "allow" | "deny" | "ask" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function replyPayloadOf(event: unknown): Record<string, unknown> | undefined {
  if (!isRecord(event)) return undefined
  const payload = isRecord(event.data) ? event.data : event
  return payload
}

/**
 * Windows fallback for the lsof-based listenPortOf(): `lsof` does not exist
 * there, so resolveServeOrigin() alone cannot find the embedded server's port.
 * Reads this process's LISTENING TCP ports from netstat.
 */
async function windowsListenPorts(pid = process.pid): Promise<number[]> {
  if (process.platform !== "win32") return []
  try {
    const proc = Bun.spawn(["netstat", "-ano", "-p", "tcp"], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const text = await new Response(proc.stdout).text()
    const ports = new Set<number>()
    for (const line of text.split("\n")) {
      const columns = line.trim().split(/\s+/)
      // proto local-address foreign-address state pid
      if (columns.length < 5 || !/^LISTENING$/i.test(columns[3])) continue
      if (columns[4] !== String(pid)) continue
      const local = columns[1]
      const port = Number(local.substring(local.lastIndexOf(":") + 1))
      if (Number.isInteger(port) && port > 0) ports.add(port)
    }
    return [...ports]
  } catch {
    return []
  }
}

/**
 * Implements the V1 ToolContext.ask() contract for tools that OpenCode v2
 * projects through ctx.tool.transform.
 *
 * Why this exists: the v2 plugin host narrows ctx.permission to
 * hook/list/get/reply (no request creation), and a projected tool's execute
 * context carries no ask at all. The platform's supported external surface
 * `POST /api/session/{sessionID}/permission` (Permission.ask) parks a REAL
 * pending request — clients prompt on permission.asked and answer through
 * session.permission.reply — and the outcome arrives on the event bus as a
 * permission.replied event, which a plugin can read via ctx.event.
 *
 * Semantics (mirrors core's Permission.assert):
 *  - rules say allow  -> resolves
 *  - rules say deny   -> rejects (SkillPermissionDeniedError)
 *  - rules say ask    -> the user is prompted; once/always resolves, reject
 *                        rejects, and an aborted tool call rejects its own
 *                        request best-effort so no prompt is left dangling
 *  - no reachable server origin -> resolves with a logged skip (fix 23
 *    behavior; documented fail-open)
 */
export function createPermissionBridge(ctx: V2Context, deps: PermissionBridgeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch
  const argv = deps.argv ?? process.argv
  const listenPort = deps.listenPort ?? (async () => (await windowsListenPorts())[0])
  const probeTimeoutMs = deps.probeTimeoutMs ?? 2000
  const retryOriginAfterMs = deps.retryOriginAfterMs ?? 30_000

  let resolvedOrigin: string | undefined
  let failedAt = 0

  function authHeaders(): Headers {
    const headers = new Headers({ "content-type": "application/json" })
    const auth = getServerBasicAuthHeader()
    if (auth) headers.set("Authorization", auth)
    return headers
  }

  async function looksLikeOpenCode(origin: string): Promise<boolean> {
    try {
      const response = await fetchImpl(new URL("/api/session/active", origin).toString(), {
        headers: authHeaders(),
        signal: AbortSignal.timeout(probeTimeoutMs),
      })
      return response.ok || response.status === 401
    } catch {
      return false
    }
  }

  async function resolveUsableOrigin(): Promise<string | undefined> {
    if (resolvedOrigin) return resolvedOrigin
    if (Date.now() - failedAt < retryOriginAfterMs) return undefined
    const candidates = new Set<string>()
    const direct = await resolveServeOrigin({ argv, listenPort }).catch(() => undefined)
    if (direct) candidates.add(direct)
    for (const port of await windowsListenPorts()) {
      candidates.add(`http://127.0.0.1:${port}`)
    }
    for (const candidate of [...candidates].slice(0, 4)) {
      if (await looksLikeOpenCode(candidate)) {
        resolvedOrigin = candidate
        return candidate
      }
    }
    failedAt = Date.now()
    return undefined
  }

  async function createRequest(
    origin: string,
    tool: BridgeToolContext,
    input: V1AskInput,
    signal?: AbortSignal,
  ): Promise<CreateOutcome> {
    const url = new URL(`/api/session/${encodeURIComponent(tool.sessionID)}/permission`, origin)
    const response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: input.permission,
        resources: input.patterns,
        save: input.always,
        metadata: input.metadata,
        agent: tool.agent,
        ...(tool.messageID !== undefined && tool.id !== undefined
          ? { source: { type: "tool", messageID: tool.messageID, id: tool.id } }
          : {}),
      }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`permission create failed with HTTP ${response.status}`)
    }
    const body: unknown = await response.json()
    const data = isRecord(body) && isRecord(body.data) ? body.data : body
    if (!isRecord(data) || typeof data.id !== "string" || typeof data.effect !== "string") {
      throw new Error("permission create returned an unexpected payload")
    }
    return { id: data.id, effect: data.effect as CreateOutcome["effect"] }
  }

  function rejectOwnRequest(sessionID: string, requestID: string): void {
    try {
      const permission = ctx.permission as
        | { reply?: (input: { sessionID: string; requestID: string; decision: "reject" }) => Promise<unknown> }
        | undefined
      void permission?.reply?.({ sessionID, requestID, decision: "reject" }).catch(() => {})
    } catch {
      // best-effort only
    }
  }

  function waitForReply(requestID: string, sessionID: string, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        signal?.removeEventListener("abort", onAbort)
        fn()
      }
      const onAbort = () => {
        rejectOwnRequest(sessionID, requestID)
        settle(() => reject(new Error("skill permission request was aborted before the user answered")))
      }
      if (signal?.aborted) return onAbort()
      signal?.addEventListener("abort", onAbort, { once: true })
      void (async () => {
        try {
          const stream = ctx.event.subscribe()
          for await (const event of stream) {
            const payload = replyPayloadOf(event)
            if (!payload) continue
            if ((event as { type?: unknown }).type !== "permission.replied") continue
            if (payload.requestID !== requestID) continue
            const reply = payload.reply
            settle(() => {
              if (reply === "reject") {
                reject(new SkillPermissionDeniedError(`Permission denied: skill ${String(payload.requestID)}`))
              } else {
                resolve()
              }
            })
            return
          }
          // The stream ended without our reply: unpark the request and fail loudly.
          rejectOwnRequest(sessionID, requestID)
          settle(() => reject(new Error("skill permission event stream ended before the user answered")))
        } catch (error) {
          rejectOwnRequest(sessionID, requestID)
          settle(() => reject(error instanceof Error ? error : new Error(String(error))))
        }
      })()
    })
  }

  async function ask(tool: BridgeToolContext, input: V1AskInput): Promise<void> {
    const origin = await resolveUsableOrigin()
    if (!origin) {
      log("[skill] v2 permission bridge: no server origin; skill permission prompt skipped", {
        skill: input.patterns.join(", "),
        sessionID: tool.sessionID,
      })
      return
    }
    let created: CreateOutcome
    try {
      created = await createRequest(origin, tool, input, tool.signal)
    } catch (error) {
      // Infrastructure failure before anything was shown to the user: keep the
      // fix-23 behavior (documented fail-open) instead of bricking the tool.
      log("[skill] v2 permission bridge: create failed; skill permission prompt skipped", {
        skill: input.patterns.join(", "),
        sessionID: tool.sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    if (created.effect === "deny") {
      throw new SkillPermissionDeniedError(`Permission denied: ${input.permission} ${input.patterns.join(", ")}`)
    }
    if (created.effect !== "ask") return
    log("[skill] v2 permission bridge: asking the user", {
      skill: input.patterns.join(", "),
      sessionID: tool.sessionID,
      requestID: created.id,
    })
    await waitForReply(created.id, tool.sessionID, tool.signal)
  }

  return { ask }
}

export type PermissionBridge = ReturnType<typeof createPermissionBridge>
