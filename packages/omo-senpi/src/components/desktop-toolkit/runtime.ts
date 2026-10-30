import { isAbsolute } from "node:path"

import { deferUntilAfterFirstPaint } from "../../extension/startup-deferral"
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { DESKTOP_TOOLKIT_TOOL_NAME, TOOLKIT_REQUEST_EVENT, TOOLKIT_GRANT_RPC, TOOLKITS_CONTEXT_KEY, type ToolkitGrant } from "./index"
import { callThreadTool, listThreadTools } from "./thread-tools"
import { callingSessionId, createHostToolRoutes } from "./host-tool-routes"
import { type LoadSdk, registerHostToolExecution } from "./host-tool-execution"

const DEFAULT_ACQUIRE_TIMEOUT_MS = 15_000
// Turns to wait after the 1st, 2nd and 3rd failed attempt before the next background retry. After the 4th failure the
// session stops asking: an app that never offers the grant costs at most three retries, not one request per turn forever.
const RETRY_GAPS_IN_TURNS: readonly number[] = [1, 2, 4]
const DISCOVERY_TOOLKITS = ["thread", "host"] as const

const PARAMETERS = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["acquire"] },
    toolkit: { type: "string" },
  },
  required: ["op", "toolkit"],
  additionalProperties: false,
} as const

type Settled = { readonly ok: true; readonly grant: ToolkitGrant } | { readonly ok: false; readonly reason: string }
interface SessionDiscovery {
  readonly toolkit: (typeof DISCOVERY_TOOLKITS)[number]
  readonly controller: AbortController
  startupPending: boolean
  running?: Promise<void>
  // Set after a failed attempt: later turns retry in the background instead of waiting on an app that may never answer.
  failed: boolean
  failures: number
  turnsSinceFailure: number
}

function reply(details: Settled) {
  return { content: [{ type: "text", text: JSON.stringify(details) }], details }
}

function offeredToolkits(sessionContext: unknown): ReadonlySet<string> {
  if (typeof sessionContext !== "object" || sessionContext === null) return new Set()
  const raw = (sessionContext as Record<string, unknown>)[TOOLKITS_CONTEXT_KEY]
  if (typeof raw !== "string") return new Set()
  return new Set(raw.split(",").map((name) => name.trim()).filter((name) => name.length > 0))
}

function parseGrant(value: unknown): ToolkitGrant | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { endpoint, tokenFile } = value as Record<string, unknown>
  if (typeof endpoint !== "string" || typeof tokenFile !== "string" || !isAbsolute(tokenFile)) return undefined
  try {
    const url = new URL(endpoint)
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username !== "" || url.password !== "" || url.search !== "") return undefined
  } catch {
    return undefined
  }
  return { endpoint, tokenFile }
}

// A failed attempt is over before it is reported, so the next turn starts a fresh retry instead of joining it.
function failAttempt(state: SessionDiscovery): void {
  state.failed = true
  state.failures += 1
  state.turnsSinceFailure = 0
  state.running = undefined
}

/** Counts this turn and reports whether the capped backoff allows a background retry on it. */
function retryDue(state: SessionDiscovery): boolean {
  state.turnsSinceFailure += 1
  const gap = RETRY_GAPS_IN_TURNS[state.failures - 1]
  return gap !== undefined && state.turnsSinceFailure >= gap
}

function isPreviewEvent(event: unknown): boolean {
  return typeof event === "object" && event !== null && "preview" in event && event.preview === true
}

/** Asks the app for a toolkit it hosts for this session's thread; only toolkits listed in `omo_toolkits` are requested. */
export function createDesktopToolkitRuntime(options: { readonly timeoutMs?: number; readonly loadSdk?: LoadSdk } = {}): OmoSenpiComponent {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS
  return {
    name: "desktop-toolkit",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      if (typeof pi.registerTool !== "function") return
      const pending = new Map<string, (settled: Settled) => void>()
      const sessions = new Map<string, SessionDiscovery>()
      const grants = new Map<string, ToolkitGrant>()
      const registered = new Set<string>()
      const hostNames = typeof pi.sessionContext === "object" && pi.sessionContext !== null &&
        "host_tool_names" in pi.sessionContext && typeof pi.sessionContext.host_tool_names === "string"
        ? new Set(pi.sessionContext.host_tool_names.split(",").map((name) => name.trim()).filter(Boolean))
        : new Set<string>()

      registerHostToolExecution(pi, hostNames, options.loadSdk)
      const routes = createHostToolRoutes(pi, {
        grants, timeoutMs,
        onLost(sessionId) {
          const state = sessions.get(`host:${sessionId}`)
          if (state !== undefined) failAttempt(state)
        },
      })

      async function acquire(toolkit: string, signal?: AbortSignal): Promise<Settled> {
        if (signal?.aborted) return { ok: false, reason: "cancelled" }
        if (pi.rpc === undefined || !offeredToolkits(pi.sessionContext).has(toolkit)) {
          return { ok: false, reason: "unavailable" }
        }
        const requestId = crypto.randomUUID()
        return new Promise<Settled>((resolve) => {
          const timer = setTimeout(() => settle({ ok: false, reason: "timeout" }), timeoutMs)
          const onAbort = () => settle({ ok: false, reason: "cancelled" })
          const settle = (value: Settled) => {
            clearTimeout(timer)
            pending.delete(requestId)
            signal?.removeEventListener("abort", onAbort)
            resolve(value)
          }
          pending.set(requestId, settle)
          signal?.addEventListener("abort", onAbort, { once: true })
          pi.rpc?.emit(TOOLKIT_REQUEST_EVENT, { requestId, toolkit })
        })
      }

      pi.registerTool({
        name: DESKTOP_TOOLKIT_TOOL_NAME,
        label: "Desktop toolkit",
        description:
          "Internal channel for skills: ask the app for a toolkit it hosts for this thread, such as its in-app browser. Not for direct use.",
        parameters: PARAMETERS,
        exposure: "eval",
        permissionParser: () => [],
        executionMode: "parallel",
        async execute(_toolCallId: string, params: { readonly op?: unknown; readonly toolkit?: unknown }) {
          const toolkit = typeof params.toolkit === "string" ? params.toolkit : ""
          if (params.op !== "acquire" || toolkit === "") return reply({ ok: false, reason: "invalid_request" })
          return reply(await acquire(toolkit))
        },
      })

      pi.rpc?.handle?.(TOOLKIT_GRANT_RPC, (data: unknown) => {
        const message = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}
        const settle = typeof message.requestId === "string" ? pending.get(message.requestId) : undefined
        if (settle === undefined) return { accepted: false }
        const grant = parseGrant(message.grant)
        if (grant !== undefined) {
          settle({ ok: true, grant })
          return { accepted: true }
        }
        const refusal = message.refusal
        const reason =
          typeof refusal === "object" && refusal !== null && typeof (refusal as Record<string, unknown>).reason === "string"
            ? String((refusal as Record<string, unknown>).reason)
            : "invalid_grant"
        settle({ ok: false, reason })
        return { accepted: true }
      })

      async function discover(sessionId: string, state: SessionDiscovery): Promise<void> {
        if (state.controller.signal.aborted || grants.has(`${state.toolkit}:${sessionId}`)) return
        if (state.running !== undefined) return state.running
        state.startupPending = false
        const run: Promise<void> = runDiscovery(sessionId, state).finally(() => {
          if (state.running === run) state.running = undefined
        })
        state.running = run
        return run
      }

      async function runDiscovery(sessionId: string, state: SessionDiscovery): Promise<void> {
        const signal = state.controller.signal
        try {
          const settled = await acquire(state.toolkit, signal)
          if (signal.aborted) return
          if (!settled.ok) {
            failAttempt(state)
            ctx.logger.info("desktop thread toolkit unavailable", { reason: settled.reason === "timeout" ? "timeout" : "grant_refused" })
            return
          }
          const tools = await listThreadTools(settled.grant, timeoutMs, signal, (reason) =>
            ctx.logger.info("desktop thread toolkit skipped tool", { reason }))
          if (signal.aborted) return
          state.failed = false
          state.failures = 0
          grants.set(`${state.toolkit}:${sessionId}`, settled.grant)
          for (const tool of tools) {
            const attachment = tool.attachment
            if (state.toolkit === "host") {
              if (attachment === undefined || !hostNames.has(attachment.name)) continue
              routes.set(attachment.name, tool.name, sessionId)
              continue
            }
            if (attachment !== undefined) continue
            const name = `desktop_${tool.name}`
            if (registered.has(name)) continue
            const inventory: unknown = "getAllTools" in pi && typeof pi.getAllTools === "function" ? pi.getAllTools() : []
            if (Array.isArray(inventory) && inventory.some((entry: unknown) =>
              typeof entry === "object" && entry !== null && "name" in entry && entry.name === name)) continue
            pi.registerTool({
              name,
              label: name,
              description: tool.description ?? "",
              parameters: tool.inputSchema,
              async execute(_id: string, args: Record<string, unknown>, signal?: AbortSignal, _onUpdate?: unknown, callCtx?: unknown) {
                const caller = callingSessionId(callCtx)
                // Never substitute the registering session when the caller has no grant.
                const grant = caller === undefined ? undefined : grants.get(`thread:${caller}`)
                return callThreadTool(grant, tool.name, args, timeoutMs, signal)
              },
            })
            registered.add(name)
          }
        } catch {
          // Remote errors may echo the bearer. Only a fixed diagnostic crosses this boundary.
          if (signal.aborted) return
          failAttempt(state)
          ctx.logger.info("desktop thread toolkit unavailable", { reason: "discovery_failed" })
        }
      }

      pi.on("session_start", (_event, eventCtx) => {
        const offered = offeredToolkits(pi.sessionContext)
        const toolkits = DISCOVERY_TOOLKITS.filter((toolkit) => offered.has(toolkit))
        if (pi.rpc === undefined || toolkits.length === 0) {
          ctx.logger.debug?.("desktop thread toolkit unavailable", { reason: "not_offered" })
          return
        }
        const sessionId = callingSessionId(eventCtx)
        if (sessionId === undefined) {
          ctx.logger.info("desktop thread toolkit unavailable", { reason: "missing_session" })
          return
        }
        for (const toolkit of toolkits) {
          const key = `${toolkit}:${sessionId}`
          if (sessions.has(key)) continue
          const state: SessionDiscovery = { toolkit, controller: new AbortController(), startupPending: true, failed: false, failures: 0, turnsSinceFailure: 0 }
          sessions.set(key, state)
          deferUntilAfterFirstPaint(ctx, "desktop thread toolkit", () =>
            state.startupPending ? discover(sessionId, state) : undefined)
        }
      })
      // The first real turn joins the bounded startup attempt. After a failure, retries run in the background without
      // waiting, on the turns RETRY_GAPS_IN_TURNS allows, so an app that never answers cannot hold any prompt for the
      // timeout and is not asked on every turn forever.
      // A prompt-cache preview pass must not start a grant request: only the real turn does (senpi#3994).
      pi.on("before_agent_start", (event, eventCtx) => {
        if (isPreviewEvent(event)) return
        const sessionId = callingSessionId(eventCtx)
        if (sessionId === undefined) return
        const pending: Promise<void>[] = []
        for (const toolkit of DISCOVERY_TOOLKITS) {
          const state = sessions.get(`${toolkit}:${sessionId}`)
          if (state === undefined) continue
          if (!state.failed) pending.push(discover(sessionId, state))
          else if (state.running === undefined && retryDue(state)) void discover(sessionId, state)
        }
        return Promise.all(pending)
      }, { previewSafe: true })
      pi.on("session_shutdown", (_event, eventCtx) => {
        const sessionId = callingSessionId(eventCtx)
        if (sessionId === undefined) return
        for (const toolkit of DISCOVERY_TOOLKITS) {
          const key = `${toolkit}:${sessionId}`
          sessions.get(key)?.controller.abort()
          sessions.delete(key)
          grants.delete(key)
        }
        routes.clear(sessionId)
      })
    },
  }
}
