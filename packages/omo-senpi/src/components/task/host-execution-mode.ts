import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import {
  createExecutionModeGate,
  ensureTaskDaemon,
  HostUnavailableError,
  resolveAutoExecutionMode,
  type EnsureTaskDaemonPort,
  type ExecutionMode,
  type ExecutionModeGate,
} from "@oh-my-opencode/senpi-task"

import { log } from "@oh-my-opencode/utils"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"

/**
 * How this parent session answers `task.default_execution_mode: "auto"`, and how it tells the
 * parent when the shared daemon could not take its children.
 *
 * The answer is a SESSION fact: asked once, at the first spawn that needs it, and kept for the rest
 * of the session even if the daemon dies later - a child's mode must never depend on daemon health
 * at spawn time.
 */

/** One line per distinct reason. The token (`host_unavailable:<reason>`) is the dedup key. */
export interface HostNotices {
  add(message: string): () => void
  list(): readonly string[]
}

export function createHostNotices(log: (message: string) => void): HostNotices {
  const byToken = new Map<string, { message: string; references: number }>()
  return {
    add: (message) => {
      const token = message.split(" ")[0] ?? message
      const existing = byToken.get(token)
      if (existing === undefined) {
        byToken.set(token, { message, references: 1 })
        log(message)
      } else {
        existing.references += 1
      }
      let released = false
      return () => {
        if (released) return
        released = true
        const current = byToken.get(token)
        if (current === undefined) return
        current.references -= 1
        if (current.references === 0) byToken.delete(token)
      }
    },
    list: () => [...byToken.values()].map((entry) => entry.message),
  }
}

export interface HostExecutionModeDeps {
  readonly settings: OmoTaskSettings
  readonly platform: NodeJS.Platform
  readonly agentDir: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly notices: HostNotices
  readonly ensureDaemon?: EnsureTaskDaemonPort
}

export function createHostExecutionModeGate(deps: HostExecutionModeDeps): ExecutionModeGate {
  return createExecutionModeGate(() => resolveMode(deps))
}

async function resolveMode(deps: HostExecutionModeDeps): Promise<ExecutionMode> {
  // A platform or a configuration that rules the daemon out never ensures one: a machine that opted
  // out of host sessions must not get a daemon started behind its back.
  const withoutDaemon = resolveAutoExecutionMode({
    platform: deps.platform,
    processRunner: deps.settings.process_runner,
    capabilities: undefined,
  })
  if (deps.settings.process_runner !== "host" || deps.platform === "win32") return withoutDaemon

  const ensure = deps.ensureDaemon ?? ensureTaskDaemon
  try {
    const daemon = await ensure({
      agentDir: deps.agentDir,
      env: deps.env,
      policy: deps.settings.host_engine_policy,
      ...(deps.settings.host_idle_exit_ms === undefined
        ? {}
        : { ports: { idleExitMs: deps.settings.host_idle_exit_ms } }),
    })
    const mode = resolveAutoExecutionMode({
      platform: deps.platform,
      processRunner: deps.settings.process_runner,
      capabilities: daemon.capabilities,
    })
    if (mode === "in-process") deps.notices.add(unavailableNotice("capability", "the daemon does not advertise generation_handoff"))
    return mode
  } catch (error) {
    deps.notices.add(
      error instanceof HostUnavailableError
        ? unavailableNotice(error.reason, error.message)
        : unavailableNotice("ensure_failed", error instanceof Error ? error.message : String(error)),
    )
    return "in-process"
  }
}

/** The SAME token shape `RpcHostRunner` warns with, so both sources dedupe against each other. */
function unavailableNotice(reason: string, detail: string): string {
  return `host_unavailable:${reason} - task children run in this process: ${detail}`
}

/** What ONE parent session needs to route `process` children at the shared daemon. */
export interface EngineHostRuntime {
  readonly agentDir: string
  readonly notices: HostNotices
  readonly executionModeGate: ExecutionModeGate
}

/**
 * The session's daemon wiring, assembled once: the notice list the runner and the gate share (so a
 * reason reaches `task_output` exactly once), and the gate that answers `auto`.
 */
export function createEngineHostRuntime(settings: OmoTaskSettings): EngineHostRuntime {
  const notices = createHostNotices((message) => log("omo-senpi task daemon unavailable", { message }))
  const agentDir = resolveAgentHome({ env: process.env })
  const gate = createHostExecutionModeGate({ settings, platform: process.platform, agentDir, env: process.env, notices })
  return { agentDir, notices, executionModeGate: gate }
}
