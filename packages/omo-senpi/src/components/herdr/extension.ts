import { isHostWarmupSession, readSessionRole } from "@oh-my-opencode/senpi-task"

import { HerdrClient, type HerdrConnect } from "./client"
import { buildResumeArgv, resolveHerdrAgentName } from "./resume"
import {
  HERDR_BLOCKED_EVENT,
  initialHerdrState,
  isHerdrBlockedEvent,
  isTerminalMonitorStateEvent,
  isWakeSourceStateEvent,
  reduceHerdrState,
  selectHerdrReport,
  TERMINAL_MONITOR_STATE_EVENT,
  WAKE_SOURCE_STATE_EVENT,
  type HerdrReporterState,
} from "./state"
import { countRunningChildTasks } from "./tasks"

const CHILD_TASK_POLL_MS = 4_000

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function stringField(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function callStringMethod(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const method = source?.[key]
  if (typeof method !== "function") return undefined
  try {
    const value = Reflect.apply(method, source, [])
    return typeof value === "string" && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export interface HerdrExtensionDeps {
  readonly env?: NodeJS.ProcessEnv
  readonly connect?: HerdrConnect
  readonly now?: () => number
  readonly countChildren?: (cwd: string, sessionId: string | undefined) => number
  readonly debug?: (message: string) => void
}

/**
 * The omo Herdr reporter, shipped as the `extensions/herdr-omo.js` Pi extension entry. Senpi's
 * builtin herdr reporter (agent `pi`, source `custom:senpi`) deliberately defers to any loaded
 * `herdr-*` extension file without a `HERDR_INTEGRATION_ID=` marker, so this file takes over the
 * pane entirely and reports agent `omo` (`senpi` on a bare-senpi install) with a `resume_argv`
 * the builtin never sends.
 *
 * Wire protocol mirrors the builtin: newline-delimited JSON-RPC over `HERDR_SOCKET_PATH`
 * (`pane.report_agent` / `pane.report_agent_session` / `pane.report_metadata` /
 * `pane.release_agent`), never the per-report CLI spawn — the socket drains in-process and the
 * release is awaited before the host tears the session down.
 */
export function createHerdrExtension(deps: HerdrExtensionDeps = {}) {
  return (pi: {
    on(event: string, handler: (payload: unknown, ctx?: unknown) => unknown): void
    events?: { on(name: string, handler: (payload: unknown) => void): () => void }
    readonly sessionContext?: unknown
  }): void => {
    const env = deps.env ?? process.env
    const debug = deps.debug ?? (() => {})
    const agent = resolveHerdrAgentName(env)
    const countChildren = deps.countChildren ?? countRunningChildTasks

    let client: HerdrClient | undefined
    let bound: Record<string, unknown> | undefined
    let boundCtx: Record<string, unknown> | undefined
    let resumeArgv: readonly string[] | undefined
    let state: HerdrReporterState = initialHerdrState()
    let stopped = false
    let lastReport: string | undefined
    let title: string | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    const pending = new Set<Promise<boolean>>()

    const owns = (ctx: unknown): boolean => !stopped && bound !== undefined && bound === record(ctx)?.["sessionManager"]

    const sessionRef = (): Record<string, unknown> => {
      const path = bound === undefined ? undefined : callStringMethod(bound, "getSessionFile")
      return path !== undefined ? { agent_session_path: path } : { agent_session_id: callStringMethod(bound ?? {}, "getSessionId") }
    }

    function send(method: string, params: Record<string, unknown>): Promise<boolean> {
      if (client === undefined) return Promise.resolve(false)
      const work = client.send(method, params).then(
        () => true,
        (error: unknown) => {
          debug(error instanceof Error ? error.message : "Herdr transport failed")
          return false
        },
      )
      pending.add(work)
      void work.then(() => pending.delete(work))
      return work
    }

    async function publish(): Promise<void> {
      if (bound === undefined || stopped) return
      const report = selectHerdrReport(state)
      const key = JSON.stringify(report)
      if (lastReport === key) return
      lastReport = key
      const params: Record<string, unknown> = { agent, ...report, ...sessionRef() }
      if (resumeArgv !== undefined) params.resume_argv = [...resumeArgv]
      if (!(await send("pane.report_agent", params)) && lastReport === key) {
        lastReport = undefined
      }
    }

    async function reportTitle(ctx: Record<string, unknown>): Promise<void> {
      const next = callStringMethod(record(ctx["sessionManager"]), "getSessionName") ?? ""
      if (title === next) return
      title = next
      if (!(await send("pane.report_metadata", { title: next, display_agent: next })) && title === next) {
        title = undefined
      }
    }

    function refreshChildren(ctx: Record<string, unknown>): void {
      const cwd = stringField(ctx, "cwd") ?? process.cwd()
      const sessionId = callStringMethod(record(ctx["sessionManager"]), "getSessionId")
      state = reduceHerdrState(state, { type: "children", count: countChildren(cwd, sessionId) })
    }

    function isIdle(ctx: Record<string, unknown>): boolean {
      const probe = ctx["isIdle"]
      if (typeof probe !== "function") return true
      try {
        return Reflect.apply(probe, ctx, []) === true
      } catch {
        return true
      }
    }

    function claimable(): boolean {
      return readSessionRole(pi, env) === undefined && !isHostWarmupSession(pi)
    }

    function unbind(): void {
      bound = undefined
      boundCtx = undefined
      resumeArgv = undefined
      state = initialHerdrState()
      lastReport = undefined
      title = undefined
      if (poll !== undefined) {
        clearInterval(poll)
        poll = undefined
      }
    }

    // Bus subscriptions live for the extension's lifetime; handlers ignore events while no TUI
    // session owns the pane so navigation between sessions never stacks listeners.
    pi.events?.on(HERDR_BLOCKED_EVENT, (data: unknown) => {
      if (stopped || bound === undefined || !isHerdrBlockedEvent(data)) return
      state = reduceHerdrState(state, { type: "blocked", ...data })
      void publish()
    })
    pi.events?.on(TERMINAL_MONITOR_STATE_EVENT, (data: unknown) => {
      if (stopped || bound === undefined || !isTerminalMonitorStateEvent(data)) return
      state = reduceHerdrState(state, { type: "monitors", count: data.activeCount })
      void publish()
    })
    pi.events?.on(WAKE_SOURCE_STATE_EVENT, (data: unknown) => {
      if (stopped || bound === undefined || !isWakeSourceStateEvent(data)) return
      state = reduceHerdrState(state, { type: "wake-source", source: data.source, count: data.activeCount })
      void publish()
    })

    pi.on("session_start", (event: unknown, ctx: unknown) => {
      if (stopped) return
      const context = record(ctx)
      if (context === undefined || context["mode"] !== "tui") return
      const socketPath = env.HERDR_SOCKET_PATH
      const paneId = env.HERDR_PANE_ID
      if (env.HERDR_ENV !== "1" || typeof socketPath !== "string" || socketPath.length === 0) return
      if (typeof paneId !== "string" || paneId.length === 0) return
      if (!claimable()) return

      const sessionManager = record(context["sessionManager"])
      if (sessionManager === undefined) return
      bound = sessionManager
      boundCtx = context
      client = new HerdrClient(socketPath, paneId, { connect: deps.connect, now: deps.now })

      const sessionId = callStringMethod(sessionManager, "getSessionId")
      const model = record(context["model"])
      resumeArgv =
        sessionId === undefined
          ? undefined
          : buildResumeArgv(
              agent,
              sessionId,
              { provider: stringField(model, "provider"), id: stringField(model, "id") },
              stringField(context, "thinkingLevel"),
            )

      state = reduceHerdrState(initialHerdrState(), { type: "turn", active: !isIdle(context) })
      refreshChildren(context)

      poll = setInterval(() => {
        const active = boundCtx
        if (stopped || active === undefined) return
        refreshChildren(active)
        void publish()
      }, CHILD_TASK_POLL_MS)
      poll.unref?.()

      void Promise.all([
        reportTitle(context),
        send("pane.report_agent_session", {
          agent,
          ...sessionRef(),
          session_start_source: stringField(record(event), "reason"),
          ...(resumeArgv === undefined ? {} : { resume_argv: [...resumeArgv] }),
        }),
        publish(),
      ])
    })

    pi.on("session_info_changed", (_event: unknown, ctx: unknown) => {
      if (owns(ctx)) void reportTitle(record(ctx)!)
    })

    pi.on("agent_start", (_event: unknown, ctx: unknown) => {
      if (!owns(ctx)) return
      state = reduceHerdrState(state, { type: "turn", active: true })
      void publish()
    })

    pi.on("agent_settled", (_event: unknown, ctx: unknown) => {
      if (!owns(ctx)) return
      state = reduceHerdrState(state, { type: "turn", active: !isIdle(record(ctx)!) })
      refreshChildren(record(ctx)!)
      void publish()
    })

    // The user aborting outside an active run stops in-flight work without an agent_end edge.
    pi.on("session_abort", (_event: unknown, ctx: unknown) => {
      if (!owns(ctx)) return
      state = reduceHerdrState(state, { type: "turn", active: false })
      void publish()
    })

    // Only a real quit releases the pane: on switch/reload/fork the next session_start re-binds
    // and re-reports the new session instead (per the Herdr integration contract).
    pi.on("session_shutdown", async (event: unknown, ctx: unknown) => {
      if (!owns(ctx)) return
      if (poll !== undefined) {
        clearInterval(poll)
        poll = undefined
      }
      // Drain before the host builds the successor runtime, or releases the pane.
      await Promise.all(pending)
      if (stringField(record(event), "reason") === "quit") {
        stopped = true
        await send("pane.release_agent", { agent })
      }
      unbind()
    })

    debug(`omo-senpi herdr reporter loaded (agent ${agent})`)
  }
}
