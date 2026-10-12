import type { Plugin } from "@opencode/plugin"

import { log } from "../shared/logger"
import { getServerBasicAuthHeader } from "../shared/opencode-server-auth"
import { spawnWithWindowsHide } from "../shared/spawn-with-windows-hide"
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
  listenPorts?: () => Promise<number[]>
  probeTimeoutMs?: number
  retryOriginAfterMs?: number
  createTimeoutMs?: number
  reconcileIntervalMs?: number
  failClosed?: boolean
  createID?: () => string
}

export class SkillPermissionDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SkillPermissionDeniedError"
  }
}

/** The permission system could not be consulted and the outcome cannot be assumed. */
export class SkillPermissionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SkillPermissionUnavailableError"
  }
}

type CreateOutcome = { id: string; effect: "allow" | "deny" | "ask" }
type PendingState = "pending" | "absent" | "unknown"

class CreateHttpError extends Error {
  constructor(readonly status: number) {
    super(`permission create failed with HTTP ${status}`)
    this.name = "CreateHttpError"
  }
}

const ABORTED_MESSAGE = "skill permission request was aborted before the user answered"
const NO_ORIGIN_SKIP = "[skill] v2 permission bridge: no server origin; skill permission prompt skipped"
const CREATE_FAILED_SKIP = "[skill] v2 permission bridge: create failed; skill permission prompt skipped"
const REPLY_BUFFER_LIMIT = 64
const NETSTAT_TIMEOUT_MS = 5000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/** A permission.replied event as { requestID, reply }, whatever envelope carried it. */
function repliedEvent(event: unknown): { requestID: string; reply: string } | undefined {
  if (!isRecord(event) || event.type !== "permission.replied") return undefined
  const payload = isRecord(event.data) ? event.data : isRecord(event.properties) ? event.properties : event
  if (typeof payload.requestID !== "string" || typeof payload.reply !== "string") return undefined
  return { requestID: payload.requestID, reply: payload.reply }
}

function pendingList(body: unknown): unknown[] | undefined {
  if (Array.isArray(body)) return body
  if (isRecord(body) && Array.isArray(body.data)) return body.data
  return undefined
}

function defaultRequestID(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  const random = crypto.getRandomValues(new Uint8Array(14))
  return `per_${Date.now().toString(16).padStart(12, "0")}${Array.from(random, (byte) => alphabet[byte % 62]).join("")}`
}

function withDeadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

/**
 * Windows fallback for the lsof-based listenPortOf(): `lsof` does not exist
 * there, so resolveServeOrigin() alone cannot find the embedded server's port.
 * Reads this process's LISTENING TCP ports from netstat.
 */
async function windowsListenPorts(pid = process.pid): Promise<number[]> {
  if (process.platform !== "win32") return []
  try {
    const proc = spawnWithWindowsHide(["netstat", "-ano", "-p", "tcp"], { stdout: "pipe", stderr: "ignore" })
    const timer = setTimeout(() => proc.kill(), NETSTAT_TIMEOUT_MS)
    void proc.exited.catch(() => undefined)
    try {
      if (!proc.stdout) return []
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
    } finally {
      clearTimeout(timer)
    }
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
 *                        rejects
 *  - an aborted tool call always rejects, and unparks its own request
 *  - the bridge chooses the request id and listens for the reply BEFORE it
 *    creates the request, so a fast answer cannot be missed and a create whose
 *    response was lost can be recognised as parked
 *  - a create failure resolves ONLY when the bridge has verified that nothing
 *    was parked (the documented fail-open for infrastructure trouble; set
 *    OMO_V2_PERMISSION_FAIL_CLOSED=1 to reject instead). If that cannot be
 *    verified, or a parked request disappears without an observed reply, it
 *    rejects
 *  - no reachable server origin -> resolves with a logged skip (fix 23
 *    behavior; same documented fail-open, same switch)
 */
export function createPermissionBridge(ctx: V2Context, deps: PermissionBridgeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch
  const argv = deps.argv ?? process.argv
  const listenPorts = deps.listenPorts ?? (() => windowsListenPorts())
  const listenPort = deps.listenPort ?? (async () => (await listenPorts())[0])
  const probeTimeoutMs = deps.probeTimeoutMs ?? 2000
  const retryOriginAfterMs = deps.retryOriginAfterMs ?? 30_000
  const createTimeoutMs = deps.createTimeoutMs ?? 15_000
  const reconcileIntervalMs = deps.reconcileIntervalMs ?? 5000
  const failClosed = deps.failClosed ?? process.env.OMO_V2_PERMISSION_FAIL_CLOSED === "1"
  const createID = deps.createID ?? defaultRequestID

  let resolvedOrigin: string | undefined
  let failedAt = 0

  function authHeaders(): Headers {
    const headers = new Headers({ "content-type": "application/json" })
    const auth = getServerBasicAuthHeader()
    if (auth) headers.set("Authorization", auth)
    return headers
  }

  async function answersLikeOpenCode(origin: string, headers?: Headers): Promise<Response | undefined> {
    try {
      return await fetchImpl(new URL("/api/session/active", origin).toString(), {
        ...(headers ? { headers } : {}),
        signal: AbortSignal.timeout(probeTimeoutMs),
      })
    } catch {
      return undefined
    }
  }

  async function hasJsonObjectBody(response: Response): Promise<boolean> {
    try {
      return isRecord(await response.json())
    } catch {
      return false
    }
  }

  /** OpenCode refuses with a tagged JSON error ({ _tag, message }); it sends no challenge header. */
  async function hasTaggedErrorBody(response: Response): Promise<boolean> {
    try {
      const body: unknown = await response.json()
      return isRecord(body) && typeof body._tag === "string"
    } catch {
      return false
    }
  }

  /**
   * A candidate is usable only when it answers the session API with a JSON
   * object. The server password is sent only after the candidate refused an
   * anonymous request the way OpenCode does, so another listener of this
   * process never receives it.
   */
  async function looksLikeOpenCode(origin: string): Promise<boolean> {
    const anonymous = await answersLikeOpenCode(origin)
    if (!anonymous) return false
    if (anonymous.ok) return hasJsonObjectBody(anonymous)
    if (anonymous.status !== 401 || !(await hasTaggedErrorBody(anonymous))) return false
    const headers = authHeaders()
    if (!headers.has("Authorization")) return false
    const authenticated = await answersLikeOpenCode(origin, headers)
    return authenticated?.ok === true && hasJsonObjectBody(authenticated)
  }

  async function resolveUsableOrigin(): Promise<string | undefined> {
    if (resolvedOrigin) return resolvedOrigin
    if (Date.now() - failedAt < retryOriginAfterMs) return undefined
    const candidates = new Set<string>()
    const direct = await resolveServeOrigin({ argv, listenPort }).catch(() => undefined)
    if (direct) candidates.add(direct)
    for (const port of await listenPorts().catch(() => [] as number[])) {
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

  function permissionUrl(origin: string, sessionID: string, suffix = ""): string {
    return new URL(`/api/session/${encodeURIComponent(sessionID)}/permission${suffix}`, origin).toString()
  }

  async function createRequest(
    origin: string,
    tool: BridgeToolContext,
    input: V1AskInput,
    requestID: string,
  ): Promise<CreateOutcome> {
    const response = await fetchImpl(permissionUrl(origin, tool.sessionID), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        id: requestID,
        action: input.permission,
        resources: input.patterns,
        save: input.always,
        metadata: input.metadata,
        agent: tool.agent,
        ...(tool.messageID !== undefined && tool.id !== undefined
          ? { source: { type: "tool", messageID: tool.messageID, id: tool.id } }
          : {}),
      }),
      signal: withDeadline(tool.signal, createTimeoutMs),
    })
    if (!response.ok) throw new CreateHttpError(response.status)
    const body: unknown = await response.json()
    const data = isRecord(body) && isRecord(body.data) ? body.data : body
    if (!isRecord(data) || typeof data.id !== "string" || typeof data.effect !== "string") {
      throw new Error("permission create returned an unexpected payload")
    }
    return { id: data.id, effect: data.effect as CreateOutcome["effect"] }
  }

  /** Is the request parked right now? Asks the HTTP surface, then the plugin host. */
  async function pendingState(origin: string, sessionID: string, requestID: string): Promise<PendingState> {
    const classify = (body: unknown): PendingState | undefined => {
      const list = pendingList(body)
      if (!list) return undefined
      return list.some((entry) => isRecord(entry) && entry.id === requestID) ? "pending" : "absent"
    }
    try {
      const response = await fetchImpl(permissionUrl(origin, sessionID), {
        headers: authHeaders(),
        signal: AbortSignal.timeout(probeTimeoutMs),
      })
      if (response.ok) {
        const state = classify(await response.json())
        if (state) return state
      }
    } catch {
      // fall through to the in-process view
    }
    try {
      const permission = ctx.permission as { list?: (input: { sessionID: string }) => Promise<unknown> } | undefined
      if (typeof permission?.list === "function") {
        const state = classify(await permission.list({ sessionID }))
        if (state) return state
      }
    } catch {
      // unknown
    }
    return "unknown"
  }

  function rejectOwnRequest(origin: string, sessionID: string, requestID: string): void {
    const viaHttp = () =>
      void fetchImpl(permissionUrl(origin, sessionID, `/${encodeURIComponent(requestID)}/reply`), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ decision: "reject" }),
        signal: AbortSignal.timeout(probeTimeoutMs),
      }).catch(() => {})
    try {
      const permission = ctx.permission as
        | { reply?: (input: { sessionID: string; requestID: string; decision: "reject" }) => Promise<unknown> }
        | undefined
      if (typeof permission?.reply !== "function") return viaHttp()
      void permission.reply({ sessionID, requestID, decision: "reject" }).catch(viaHttp)
    } catch {
      viaHttp()
    }
  }

  /**
   * Subscribes to the event stream and remembers every permission reply it
   * sees. Opened before the request is created; close() always ends the
   * underlying subscription.
   */
  function watchReplies() {
    const controller = new AbortController()
    const replies = new Map<string, string>()
    const listeners = new Set<() => void>()
    let ended: Error | undefined
    let iterator: AsyncIterator<unknown> | undefined
    const notify = () => {
      for (const listener of [...listeners]) listener()
    }
    void (async () => {
      try {
        const events = ctx.event as unknown as {
          subscribe: (options?: { signal?: AbortSignal }) => AsyncIterable<unknown>
        }
        iterator = events.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
        for (;;) {
          const next = await iterator.next()
          if (next.done) break
          const replied = repliedEvent(next.value)
          if (!replied) continue
          if (replies.size >= REPLY_BUFFER_LIMIT) replies.delete(replies.keys().next().value as string)
          replies.set(replied.requestID, replied.reply)
          notify()
        }
        ended = new Error("skill permission event stream ended before the user answered")
      } catch (error) {
        ended = controller.signal.aborted ? new Error(ABORTED_MESSAGE) : toError(error)
      } finally {
        notify()
      }
    })()
    return {
      // One macrotask: the subscription fiber starts before the create request leaves.
      ready: new Promise<void>((resolve) => setTimeout(resolve, 0)),
      replyFor: (requestID: string) => replies.get(requestID),
      ended: () => ended,
      onChange: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      close: () => {
        listeners.clear()
        controller.abort()
        try {
          void iterator?.return?.()?.catch(() => {})
        } catch {
          // best-effort only
        }
      },
    }
  }

  type ReplyWatcher = ReturnType<typeof watchReplies>


  function waitForReply(
    origin: string,
    requestID: string,
    tool: BridgeToolContext,
    watcher: ReplyWatcher,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let stopWatching = () => false
      let timer: ReturnType<typeof setTimeout> | undefined
      const schedule = () => {
        timer = setTimeout(() => void reconcile(), reconcileIntervalMs)
      }
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stopWatching()
        tool.signal?.removeEventListener("abort", onAbort)
        fn()
      }
      const answered = (): boolean => {
        const reply = watcher.replyFor(requestID)
        if (reply === undefined) return false
        settle(() =>
          reply === "reject"
            ? reject(new SkillPermissionDeniedError(`Permission denied: skill ${requestID}`))
            : resolve(),
        )
        return true
      }
      const onAbort = () => {
        rejectOwnRequest(origin, tool.sessionID, requestID)
        settle(() => reject(new Error(ABORTED_MESSAGE)))
      }
      const onChange = () => {
        if (answered()) return
        const ended = watcher.ended()
        if (!ended) return
        // The stream is gone and cannot deliver the answer: unpark and fail loudly.
        rejectOwnRequest(origin, tool.sessionID, requestID)
        settle(() => reject(ended))
      }
      // A reply can be published without ever reaching this subscriber. A parked
      // request that is gone without an observed reply must not hang or pass.
      async function reconcile(): Promise<void> {
        if (settled) return
        try {
          if ((await pendingState(origin, tool.sessionID, requestID)) !== "absent") return
          // The reply event may be a moment behind the pending list.
          await new Promise((done) => setTimeout(done, 250))
          if (settled || answered()) return
          settle(() =>
            reject(
              new SkillPermissionUnavailableError(
                "skill permission request was answered but the reply was not observed; refusing to proceed",
              ),
            ),
          )
        } finally {
          if (!settled) schedule()
        }
      }
      if (tool.signal?.aborted) return onAbort()
      tool.signal?.addEventListener("abort", onAbort, { once: true })
      stopWatching = watcher.onChange(onChange)
      schedule()
      onChange()
    })
  }

  /** The documented fail-open for infrastructure trouble, in one place. */
  function infrastructureSkip(skipMessage: string, tool: BridgeToolContext, input: V1AskInput, error?: unknown): void {
    const detail = {
      skill: input.patterns.join(", "),
      sessionID: tool.sessionID,
      ...(error === undefined ? {} : { error: toError(error).message }),
    }
    if (failClosed) {
      log("[skill] v2 permission bridge: permission check unavailable; skill blocked", { ...detail, cause: skipMessage })
      throw new SkillPermissionUnavailableError(`Permission check unavailable: ${input.permission} ${detail.skill}`)
    }
    log(skipMessage, detail)
  }

  /**
   * Creates the request. Returns undefined only when the bridge has verified
   * that no request is parked and the configured policy allows proceeding.
   */
  async function establish(
    origin: string,
    tool: BridgeToolContext,
    input: V1AskInput,
    requestID: string,
    watcher: ReplyWatcher,
  ): Promise<CreateOutcome | undefined> {
    let failure: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await createRequest(origin, tool, input, requestID)
      } catch (error) {
        failure = error
        if (tool.signal?.aborted) {
          rejectOwnRequest(origin, tool.sessionID, requestID)
          throw new Error(ABORTED_MESSAGE)
        }
        // A 4xx is the server refusing the request before anything was parked.
        if (error instanceof CreateHttpError && error.status >= 400 && error.status < 500) break
        // The response may have been lost after the server parked the request.
        if (watcher.replyFor(requestID) !== undefined) return { id: requestID, effect: "ask" }
        const state = await pendingState(origin, tool.sessionID, requestID)
        if (watcher.replyFor(requestID) !== undefined || state === "pending") return { id: requestID, effect: "ask" }
        if (state === "unknown") {
          rejectOwnRequest(origin, tool.sessionID, requestID)
          throw new SkillPermissionUnavailableError(
            `Permission check failed and its state could not be verified: ${toError(error).message}`,
          )
        }
      }
    }
    // A request that never got an answer may still land after the deadline: withdraw it.
    if (!(failure instanceof CreateHttpError)) rejectOwnRequest(origin, tool.sessionID, requestID)
    infrastructureSkip(CREATE_FAILED_SKIP, tool, input, failure)
    return undefined
  }

  async function ask(tool: BridgeToolContext, input: V1AskInput): Promise<void> {
    if (tool.signal?.aborted) throw new Error(ABORTED_MESSAGE)
    const origin = await resolveUsableOrigin()
    if (tool.signal?.aborted) throw new Error(ABORTED_MESSAGE)
    if (!origin) return infrastructureSkip(NO_ORIGIN_SKIP, tool, input)

    const requestID = createID()
    const watcher = watchReplies()
    try {
      await watcher.ready
      const created = await establish(origin, tool, input, requestID, watcher)
      if (!created) return
      if (created.effect === "deny") {
        throw new SkillPermissionDeniedError(`Permission denied: ${input.permission} ${input.patterns.join(", ")}`)
      }
      if (created.effect !== "ask") return
      log("[skill] v2 permission bridge: asking the user", {
        skill: input.patterns.join(", "),
        sessionID: tool.sessionID,
        requestID: created.id,
      })
      await waitForReply(origin, created.id, tool, watcher)
    } finally {
      watcher.close()
    }
  }

  return { ask }
}

export type PermissionBridge = ReturnType<typeof createPermissionBridge>
