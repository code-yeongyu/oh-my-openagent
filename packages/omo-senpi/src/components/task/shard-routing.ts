import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import {
  createLiveHostChildren,
  ensureTaskDaemon,
  HOST_NOTICE_TOKENS,
  probeWithEngine,
  readOwnHostSocket,
  readSessionContext,
  resolveShardSocket,
  RunnerError,
  SHARD_KEY_CONTEXT,
  shardKey,
  type EnsureTaskDaemonPort,
  type HostNoticeSink,
  type HostProtocolProbe,
  type HostShardEvents,
  type LiveHostChildren,
  type ShardIdentity,
  type ShardResolution,
} from "@oh-my-opencode/senpi-task"

import type { HostNotices } from "./host-execution-mode"

/**
 * WHERE this session's `process` children live: its own task host, one per session tree.
 *
 * A session opened inside a host by omo carries its tree's key in its context (`shard_key`) and
 * reuses that host - the one it runs on, which it may only attach to. Every other session (a
 * parent, a per-child-process child, a Desktop thread) is the root of its own tree and keys the
 * host by its OWN session id. The identity is read at every call, never at construction: the
 * session id changes on /new and on a session switch.
 */

const SHARD_KEY_SHAPE = /^[0-9a-f]{16}$/

/** A child reusing its tree's host does not know the tree root's id; it never writes a sidecar. */
export const INHERITED_SHARD_OWNER = "<inherited>"

export interface SessionIdentitySource {
  sessionId(): string | undefined
  sessionFile(): string | undefined
}

export interface SessionShardRouting {
  readonly ensureDaemon: EnsureTaskDaemonPort
  readonly shardResolver: () => ShardResolution
  readonly ownHostSocket: () => string | undefined
  // The session context carries an inherited tree key: this process runs inside a host.
  readonly insideHost: () => boolean
  readonly probeHost: HostProtocolProbe
  readonly onNotice: HostNoticeSink
  // Every child's transport recoveries: the parent's one crash notice per host crash.
  readonly shardEvents: HostShardEvents
  // The session's ONE registry of live host children over `shardEvents`. Every runner the session
  // builds (spawns AND revivals) shares it, so a crash names every child it took from the session.
  readonly liveChildren: LiveHostChildren
}

export type TaskHostRouting = SessionShardRouting & { readonly storeDir: string }

export interface SessionShardRoutingInput {
  readonly settings: OmoTaskSettings
  readonly runtime: SessionIdentitySource
  readonly pi: unknown
  readonly agentDir: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly notices: HostNotices
  readonly shardEvents: HostShardEvents
  readonly ensureDaemon?: EnsureTaskDaemonPort
  readonly probeHost?: HostProtocolProbe
}

function inheritedShardKey(pi: unknown): string | undefined {
  const key = readSessionContext(pi)?.[SHARD_KEY_CONTEXT]
  return key !== undefined && SHARD_KEY_SHAPE.test(key) ? key : undefined
}

export function sessionShardIdentity(runtime: SessionIdentitySource, pi: unknown): ShardIdentity {
  const inheritedKey = inheritedShardKey(pi)
  if (inheritedKey !== undefined) {
    return { kind: "p", key: inheritedKey, ownerSessionId: INHERITED_SHARD_OWNER, inherited: true }
  }
  const sessionId = runtime.sessionId()
  if (sessionId === undefined || sessionId.length === 0) {
    throw new RunnerError({
      kind: "host_unavailable",
      reason: "shard_identity_missing",
      message: "shard_identity_missing: a process child was routed before session_start attached the session",
    })
  }
  const sessionFile = runtime.sessionFile()
  return {
    kind: "p",
    key: shardKey("p", sessionId),
    ownerSessionId: sessionId,
    ...(sessionFile === undefined ? {} : { ownerSessionFile: sessionFile }),
    inherited: false,
  }
}

export function createSessionShardRouting(input: SessionShardRoutingInput): SessionShardRouting {
  const baseEnsure = input.ensureDaemon ?? ensureTaskDaemon
  // The only omo.json knob the launch spec yields to; every other launch input is the spec's, so
  // `omo daemon run` and a child-triggered ensure cannot drift.
  const idleExitMs = input.settings.host_idle_exit_ms
  const ensureDaemon: EnsureTaskDaemonPort =
    idleExitMs === undefined ? baseEnsure : (request) => baseEnsure({ ...request, ports: { ...request.ports, idleExitMs } })
  return {
    ensureDaemon,
    shardResolver: () =>
      resolveShardSocket({ agentDir: input.agentDir, env: input.env, identity: sessionShardIdentity(input.runtime, input.pi) }),
    ownHostSocket: () => readOwnHostSocket(input.pi),
    insideHost: () => inheritedShardKey(input.pi) !== undefined,
    probeHost: input.probeHost ?? probeWithEngine,
    onNotice: (token, detail) => {
      input.notices.add(detail === undefined ? token : `${token} ${detail}`)
    },
    shardEvents: input.shardEvents,
    liveChildren: createLiveHostChildren(input.shardEvents),
  }
}

export function resolutionNoticeToken(resolution: ShardResolution): string | undefined {
  return resolution.notice === undefined ? undefined : HOST_NOTICE_TOKENS[resolution.notice]
}
