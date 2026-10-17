import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import {
  readSessionRole,
  selectRevivalBatch,
  warmTaskHost,
  type ExecutionModeGate,
  type HostEndpointPort,
  type TaskManager,
} from "@oh-my-opencode/senpi-task"
import { log } from "@oh-my-opencode/utils"

import type { SenpiExtensionAPI } from "../../extension/types"
import { runsInDesktopThreadHost, startsDelegation } from "./host-prewarm-intent"
import { admitTaskStore } from "./store-admission"
import type { LiveTaskContext } from "./runtime-context"
import { createOncePerSessionGuard } from "./usage-guidance"

/**
 * Task-host warm-ups, fire-and-forget, at most once per session id, POSIX `host` runner only:
 * - revival (always on): at `session_start`, ensure the recorded socket of every suspended host-session
 *   child the reconcile will revive (capacity included) except the session's own endpoint, so the host
 *   boots while the reconcile scans and the lifecycle's revival ensure hits the per-socket ensure cache;
 * - `task.host_shard_prewarm` `"first-turn"` (default) / `"session-start"`: the session's own host, through
 *   the execution-mode gate's `warm()`. Only the root of a session tree warms: an omo-spawned session (any
 *   session role) either runs inside its tree's host, which is already serving it, or is a per-process child
 *   whose own host would boot for nothing; an explicit `default_execution_mode: "in-process"` never routes a
 *   child to a host. A session inside a Desktop thread host (`i-*`) replaces `first-turn` with the first
 *   delegation intent: the streamed start of a `task` or `task_send` call. The warm is admitted exactly
 *   like a spawn: the session's task store is registered in the agent-dir store index first, and when
 *   that fails nothing is ensured (the spawn then fails `store_index_unavailable` on its own). A failed
 *   warm is logged and settles nothing, so the first spawn ensures as usual. Once the host answers, the
 *   host's `warm` command loads what a child's session needs (`warmTaskHost`; an engine from before it
 *   gets a throwaway warm-up session): a host's first session pays for compiling and loading the
 *   extensions, and that must not be the first child's wait. Its failure is logged too; the child opens
 *   exactly as it would without it.
 * win32 is excluded: task children there run in-process or as their own processes, so there is no task
 * host to warm (the auto gate resolves in-process without ensuring one).
 */

// The earliest host edges of a submitted prompt: `input` fires before skill/template expansion, and
// `before_agent_start` covers turns that never pass through `input` (print mode, `--message`).
const FIRST_TURN_EVENTS = ["input", "before_agent_start"] as const

export interface HostPrewarmEngine {
  readonly settings: Pick<
    OmoTaskSettings,
    "process_runner" | "default_execution_mode" | "host_shard_prewarm" | "resume_children" | "reattach_on_reconcile" | "residency_max_children"
  >
  readonly runtime: {
    captureFrom(ctx: LiveTaskContext): void
    sessionId(): string | undefined
    cwd(): string
  }
  // The session's task store, registered in the agent-dir store index before any host is ensured.
  readonly stateDir: string
  readonly host: {
    readonly agentDir: string
    readonly executionModeGate: Pick<ExecutionModeGate, "warm" | "current">
    readonly hostEndpoint: Pick<HostEndpointPort, "isOwn" | "ensure">
    shardSocket(): string
    /** Test seam; `warmTaskHost` by default. */
    readonly warmHost?: (socket: string, cwd: string) => Promise<unknown>
  }
  readonly manager: Pick<TaskManager, "list">
}

export interface HostPrewarm {
  /** The session's own-host warm, or undefined when none was started for it. Never rejects. */
  settled(sessionId: string): Promise<void> | undefined
}

export function wireHostPrewarm(
  pi: SenpiExtensionAPI,
  engine: HostPrewarmEngine,
  platform: NodeJS.Platform = process.platform,
): HostPrewarm {
  const warmed = new Map<string, Promise<void>>()
  const handle: HostPrewarm = { settled: (sessionId) => warmed.get(sessionId) }
  if (engine.settings.process_runner !== "host" || platform === "win32") return handle
  const revived = createOncePerSessionGuard()
  const treeRoot = readSessionRole(pi) === undefined
  const configured = treeRoot && engine.settings.default_execution_mode !== "in-process" ? engine.settings.host_shard_prewarm : "off"
  const mode = configured === "first-turn" && runsInDesktopThreadHost(pi) ? "intent" : configured
  const attachedSession = (eventCtx: unknown): string | undefined => {
    if (typeof eventCtx === "object" && eventCtx !== null) engine.runtime.captureFrom(eventCtx)
    return engine.runtime.sessionId()
  }
  const warmOwnHost = (sessionId: string): void => {
    if (warmed.has(sessionId)) return
    warmed.set(sessionId, warmHost(engine).catch(() => undefined))
  }

  pi.on("session_start", (_payload, eventCtx) => {
    const sessionId = attachedSession(eventCtx)
    if (sessionId === undefined) return
    if (revived(sessionId)) warmRecordedHosts(engine, sessionId)
    if (mode === "session-start") warmOwnHost(sessionId)
  })
  const warmOnEdge = (eventCtx: unknown): undefined => {
    // A session that already warmed its host needs nothing from its later edges, not even a capture.
    const eventSession = contextSessionId(eventCtx)
    if (eventSession !== undefined && warmed.has(eventSession)) return undefined
    const sessionId = attachedSession(eventCtx)
    if (sessionId !== undefined) warmOwnHost(sessionId)
    return undefined
  }
  if (mode === "first-turn") {
    for (const event of FIRST_TURN_EVENTS) pi.on(event, (_payload, eventCtx) => warmOnEdge(eventCtx))
  }
  if (mode === "intent") pi.on("message_update", (payload, eventCtx) => (startsDelegation(payload) ? warmOnEdge(eventCtx) : undefined))
  return handle
}

async function warmHost(engine: HostPrewarmEngine): Promise<void> {
  if (!(await admitTaskStore(engine.host.agentDir, engine.stateDir, "host pre-warm"))) return
  const gate = engine.host.executionModeGate
  await gate.warm().catch(() => undefined)
  // Only a session whose children will run on its host warms one up; in-process children never open there.
  if (gate.current() !== "process") return
  const socket = engine.host.shardSocket()
  const warm = engine.host.warmHost ?? ((target: string, cwd: string) => warmTaskHost({ socket: target, cwd }))
  await warm(socket, engine.runtime.cwd()).catch((error: unknown) => {
    log("omo-senpi task host warm failed", { socket, error: error instanceof Error ? error.message : String(error) })
  })
}


function contextSessionId(eventCtx: unknown): string | undefined {
  if (typeof eventCtx !== "object" || eventCtx === null) return undefined
  const ctx: LiveTaskContext = eventCtx
  return ctx.sessionManager?.getSessionId()
}

function warmRecordedHosts(engine: HostPrewarmEngine, sessionId: string): void {
  if (engine.settings.resume_children === false || engine.settings.reattach_on_reconcile === false) return
  // Exactly the children the reconcile's admission batch will revive, so a capped session never
  // boots hosts for children that stay suspended.
  const records = engine.manager.list({ scope: "all" }).map(({ record }) => record)
  const { selected } = selectRevivalBatch(records, sessionId, engine.settings.residency_max_children)
  const sockets = new Set<string>()
  for (const record of selected) {
    const socket = record.runner_kind === "host-session" ? record.host_session?.socket : undefined
    // The session's own endpoint is already serving it, or not restartable from inside.
    if (socket !== undefined && !engine.host.hostEndpoint.isOwn(socket)) sockets.add(socket)
  }
  for (const socket of sockets) void engine.host.hostEndpoint.ensure(socket).catch(() => undefined)
}
