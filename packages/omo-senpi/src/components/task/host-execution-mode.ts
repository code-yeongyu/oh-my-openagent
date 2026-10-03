import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import {
  attachOwnEndpoint,
  createExecutionModeGate,
  createHostEndpointPort,
  HostUnavailableError,
  isOwnEndpoint,
  resolveAutoExecutionMode,
  RunnerError,
  type EnsureTaskDaemonPort,
  type ExecutionMode,
  type ExecutionModeGate,
  type HostEndpointPort,
  type HostProtocolProbe,
  type ShardResolution,
} from "@oh-my-opencode/senpi-task"

import { log } from "@oh-my-opencode/utils"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { admitTaskStore } from "./store-admission"
import {
  createSessionShardRouting,
  resolutionNoticeToken,
  type SessionIdentitySource,
  type SessionShardRouting,
} from "./shard-routing"
import type { CapturedUi } from "./runtime-context"
import { createShardCrashNotices } from "./shard-crash-notice"

/**
 * How this parent session answers `task.default_execution_mode: "auto"`, and how it tells the
 * parent when its own task host could not take its children.
 *
 * The answer is a SESSION fact: asked once, at the first spawn that needs it, and kept for the rest
 * of the session even if the host dies later - a child's mode must never depend on host health at
 * spawn time.
 */

/**
 * One line per distinct reason. The token is the dedup key: the message's first word
 * (`host_unavailable:<reason>`) unless the caller names a narrower one.
 */
export interface HostNotices {
  add(message: string, token?: string): () => void
  list(): readonly string[]
}

export function createHostNotices(log: (message: string) => void): HostNotices {
  const byToken = new Map<string, { message: string; references: number }>()
  return {
    add: (message, explicitToken) => {
      const token = explicitToken ?? message.split(" ")[0] ?? message
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
  readonly routing: SessionShardRouting
  // The engine's task store; when set, the first ask admits it to the agent-dir store index before it
  // may ensure a host (the host runner's admission precondition).
  readonly storeDir?: string
}

export function createHostExecutionModeGate(deps: HostExecutionModeDeps): ExecutionModeGate {
  const storeDir = deps.storeDir
  const ensuresHosts = deps.settings.process_runner === "host" && deps.platform !== "win32"
  return createExecutionModeGate(() => resolveMode(deps), {
    ...(storeDir === undefined || !ensuresHosts
      ? {}
      : { admit: () => admitTaskStore(deps.agentDir, storeDir, "auto execution mode") }),
    onEnsureFailure: (error) => {
      deps.notices.add(unavailableNotice(failureReason(error), error instanceof Error ? error.message : String(error)))
    },
    // A pre-warm failure is only logged: the first spawn asks again and reports its own failure.
    onWarmFailure: (error) => {
      log("omo-senpi task host pre-warm failed", {
        reason: failureReason(error),
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

// Rejects when the host could not be ensured; the gate decides whether that settles the session.
async function resolveMode(deps: HostExecutionModeDeps): Promise<ExecutionMode> {
  // A platform or a configuration that rules the daemon out never ensures one: a machine that opted
  // out of host sessions must not get a daemon started behind its back.
  const withoutDaemon = resolveAutoExecutionMode({
    platform: deps.platform,
    processRunner: deps.settings.process_runner,
    capabilities: undefined,
  })
  if (deps.settings.process_runner !== "host" || deps.platform === "win32") return withoutDaemon

  const resolution = deps.routing.shardResolver()
  const notice = resolutionNoticeToken(resolution)
  if (notice !== undefined) deps.notices.add(`${notice} ${resolution.socket}`)
  const mode = resolveAutoExecutionMode({
    platform: deps.platform,
    processRunner: deps.settings.process_runner,
    capabilities: await sessionHostCapabilities(deps, resolution),
  })
  if (mode === "in-process") deps.notices.add(unavailableNotice("capability", "the daemon does not advertise generation_handoff"))
  return mode
}

/**
 * What THIS session's own task host can do. The host the session itself runs behind (and the shard
 * its tree inherited) is only probed - never ensured, started or handed off from inside; every other
 * session ensures its own shard, never the machine-wide `rpc.sock`.
 */
async function sessionHostCapabilities(
  deps: HostExecutionModeDeps,
  resolution: ShardResolution,
): Promise<readonly string[] | undefined> {
  const { shard, socket } = resolution
  if (shard.inherited || isOwnEndpoint(socket, deps.routing.ownHostSocket())) {
    return (await attachOwnEndpoint(deps.routing.probeHost, socket)).capabilities
  }
  const daemon = await deps.routing.ensureDaemon({
    agentDir: deps.agentDir,
    env: deps.env,
    policy: deps.settings.host_engine_policy,
    socket,
    owner: {
      kind: shard.kind,
      key: shard.key,
      ownerSessionId: shard.ownerSessionId,
      ...(shard.ownerSessionFile === undefined ? {} : { ownerSessionFile: shard.ownerSessionFile }),
    },
    ...(resolution.notice === undefined ? {} : { sidecarNotice: resolution.notice }),
  })
  return daemon.capabilities
}

function failureReason(error: unknown): string {
  if (error instanceof HostUnavailableError) return error.reason
  if (RunnerError.is(error)) return error.failure.reason ?? "ensure_failed"
  return "ensure_failed"
}

/** The SAME token shape `RpcHostRunner` warns with, so both sources dedupe against each other. */
function unavailableNotice(reason: string, detail: string): string {
  return `host_unavailable:${reason} - task children run in this process: ${detail}`
}

/** What ONE session needs to route `process` children at its own task host. */
export interface EngineHostRuntime {
  readonly agentDir: string
  readonly notices: HostNotices
  readonly executionModeGate: ExecutionModeGate
  readonly routing: SessionShardRouting
  // The lifecycle's way back to a recorded endpoint (revival, orphan reconcile): same ensure port,
  // same own-endpoint guard, same notice list as the runner.
  readonly hostEndpoint: HostEndpointPort
  // The socket this session's NEW children would open on right now (status and notices).
  shardSocket(): string
}

export interface EngineHostRuntimeOverrides {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: NodeJS.Platform
  readonly agentDir?: string
  readonly ensureDaemon?: EnsureTaskDaemonPort
  readonly probeHost?: HostProtocolProbe
  readonly storeDir?: string
}

/**
 * The session's host wiring, assembled once: the notice list the runner, the gate and the lifecycle
 * share (so a reason reaches `task_output` exactly once), the gate that answers `auto`, and the
 * per-call shard routing. Nothing here captures the session id: it is read at every call.
 */
export function createEngineHostRuntime(
  settings: OmoTaskSettings,
  runtime: SessionIdentitySource & { ui?(): CapturedUi | undefined },
  pi: unknown,
  overrides: EngineHostRuntimeOverrides = {},
): EngineHostRuntime {
  const notices = createHostNotices((message) => log("omo-senpi task daemon unavailable", { message }))
  const env = overrides.env ?? process.env
  const agentDir = overrides.agentDir ?? resolveAgentHome({ env })
  const routing = createSessionShardRouting({
    settings,
    runtime,
    pi,
    agentDir,
    env,
    notices,
    shardEvents: createShardCrashNotices({ agentDir, notices, ui: () => runtime.ui?.() }),
    ...(overrides.ensureDaemon === undefined ? {} : { ensureDaemon: overrides.ensureDaemon }),
    ...(overrides.probeHost === undefined ? {} : { probeHost: overrides.probeHost }),
  })
  const platform = overrides.platform ?? process.platform
  const gate = createHostExecutionModeGate({
    settings,
    platform,
    agentDir,
    env,
    notices,
    routing,
    ...(overrides.storeDir === undefined ? {} : { storeDir: overrides.storeDir }),
  })
  const hostEndpoint = createHostEndpointPort({
    agentDir,
    env,
    policy: settings.host_engine_policy,
    ensureDaemon: routing.ensureDaemon,
    ownHostSocket: routing.ownHostSocket,
    insideHost: routing.insideHost,
    onNotice: routing.onNotice,
  })
  return { agentDir, notices, executionModeGate: gate, routing, hostEndpoint, shardSocket: () => routing.shardResolver().socket }
}
