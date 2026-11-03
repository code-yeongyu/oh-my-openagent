import { log } from "@oh-my-opencode/utils"

import type { HostEnginePolicy, SenpiHostProtocolInfo } from "../../lazy/senpi-barrel"
import { RunnerError } from "../in-process/runner-error"
import type { RpcRunnerSpec } from "../types"
import { TASK_DAEMON_PROTOCOL_VERSION, type EnsureTaskDaemonInput, type EnsuredTaskDaemon } from "./daemon"
import type { HostNoticeKind } from "./host-notice"
import { attachOnlyEndpoint } from "./own-endpoint"
import { registerSidecarStore, type ShardOwner } from "./shard-sidecar"
import { parseShardBasename, type ShardNotice, type ShardResolution } from "./shard-socket"
import type { HostProtocolProbe } from "./session-transport"
import { registerStoreIndex, taskStoreIndexPath } from "./store-index"

export type EnsureTaskDaemonPort = (input: EnsureTaskDaemonInput) => Promise<EnsuredTaskDaemon>
export type ShardResolver = (spec: RpcRunnerSpec) => ShardResolution

export interface ChildEndpointPorts {
  readonly agentDir: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly policy: HostEnginePolicy
  readonly ensureDaemon: EnsureTaskDaemonPort
  readonly storeDir: string
  readonly shardResolver: ShardResolver
  readonly ownHostSocket: () => string | undefined
  // This session was opened inside a host (its context carries an inherited tree key).
  readonly insideHost: () => boolean
  readonly probeHost: HostProtocolProbe
  readonly notice: (kind: HostNoticeKind, detail?: string) => void
  readonly now: () => number
}

/**
 * WHERE a child opens. A revived or reattached child names its RECORDED socket and opens there and
 * only there; a new child asks the resolver (per start - the owning session changes on /new). There
 * is no third answer: a task child is never routed to the machine-wide `rpc.sock`.
 *
 * `attachOnly` marks an endpoint this session must never ensure: its tree's shard inherited from the
 * session context (a child inside a host reuses the host it lives on).
 */
export interface ChildEndpoint {
  readonly socket: string
  readonly recorded: boolean
  readonly attachOnly: boolean
  readonly owner?: ShardOwner
  readonly sidecarNotice?: ShardNotice
  // The `tree_key` / `shard_key` the child's session context carries, so its own children stay here.
  readonly shardKey?: string
}

export function resolveChildEndpoint(ports: ChildEndpointPorts, spec: RpcRunnerSpec): ChildEndpoint {
  if (spec.hostSocket !== undefined) {
    const parsed = parseShardBasename(spec.hostSocket)
    return {
      socket: spec.hostSocket,
      recorded: true,
      attachOnly: false,
      ...(parsed?.kind === "p" ? { shardKey: parsed.key } : {}),
    }
  }
  // A JavaScript caller can still construct a runner without a resolver; that is a wiring bug, and
  // it fails LOUDLY here instead of reaching the operator daemon on `rpc.sock`.
  if (typeof ports.shardResolver !== "function") throw shardIdentityMissing("the task host runner was built without a shard resolver")
  const resolution = ports.shardResolver(spec)
  if (resolution.notice !== undefined) ports.notice(resolution.notice, resolution.socket)
  const { kind, key, ownerSessionId, ownerSessionFile, inherited } = resolution.shard
  return {
    socket: resolution.socket,
    recorded: false,
    attachOnly: inherited,
    owner: { kind, key, ownerSessionId, ...(ownerSessionFile === undefined ? {} : { ownerSessionFile }) },
    ...(resolution.notice === undefined ? {} : { sidecarNotice: resolution.notice }),
    shardKey: key,
  }
}

export function shardIdentityMissing(detail: string): RunnerError {
  return new RunnerError({
    kind: "host_unavailable",
    reason: "shard_identity_missing",
    message: `shard_identity_missing: ${detail}`,
  })
}

/**
 * The ADMISSION PRECONDITION: the child's store is durably in the agent-dir store index before any
 * host is ensured or any session opened, so no record can name an endpoint whose store the index
 * does not list. Failure is a typed `store_index_unavailable`, never a silent open.
 */
export async function admitChildStore(ports: ChildEndpointPorts): Promise<void> {
  try {
    await registerStoreIndex({ indexPath: taskStoreIndexPath(ports.agentDir), storeDir: ports.storeDir, now: ports.now })
  } catch (error) {
    ports.notice("store_index_unavailable")
    throw new RunnerError({
      kind: "host_unavailable",
      reason: "store_index_unavailable",
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    })
  }
}

export function isStoreIndexUnavailable(error: unknown): boolean {
  return RunnerError.is(error) && error.failure.reason === "store_index_unavailable"
}

/**
 * The session's OWN endpoint (or its tree's inherited shard) is only ever ATTACHED: one
 * `get_protocol_info` round trip that spawns nothing. Any generation may answer - after a handoff the
 * public path belongs to the successor while this session keeps running in its predecessor - but it
 * must speak this build's protocol. A silent endpoint is never started, handed off or replaced.
 */
export async function attachOwnEndpoint(probeHost: HostProtocolProbe, socket: string): Promise<SenpiHostProtocolInfo> {
  let info: SenpiHostProtocolInfo | undefined
  try {
    info = await probeHost(socket)
  } catch (error) {
    throw ownHostUnreachable(socket, error instanceof Error ? error.message : String(error), error)
  }
  if (info === undefined) throw ownHostUnreachable(socket, "the endpoint did not answer get_protocol_info")
  if (info.protocolVersion !== TASK_DAEMON_PROTOCOL_VERSION) {
    throw ownHostUnreachable(socket, `the endpoint speaks protocol ${info.protocolVersion}`)
  }
  return info
}

function ownHostUnreachable(socket: string, detail: string, cause?: unknown): RunnerError {
  return new RunnerError({
    kind: "host_unavailable",
    reason: "own_host_unreachable",
    message: `own_host_unreachable: ${socket}: ${detail}`,
    ...(cause === undefined ? {} : { cause }),
  })
}

/**
 * THE one place an ensure result is consumed. The engine's attach hold (senpi #2242) never reaches
 * here: `ensureTaskDaemon` releases it before returning, because its result is cached and shared.
 */
export async function ensureChildEndpoint(ports: ChildEndpointPorts, endpoint: ChildEndpoint): Promise<string> {
  if (!isEnsuredEndpoint(ports, endpoint)) {
    await attachOwnEndpoint(ports.probeHost, endpoint.socket)
    return endpoint.socket
  }
  const daemon = await ports.ensureDaemon({
    agentDir: ports.agentDir,
    env: ports.env,
    policy: ports.policy,
    socket: endpoint.socket,
    ...(endpoint.owner === undefined ? {} : { owner: endpoint.owner }),
    ...(endpoint.sidecarNotice === undefined ? {} : { sidecarNotice: endpoint.sidecarNotice }),
  })
  return daemon.socket
}

/** Whether `ensureChildEndpoint` ensures this endpoint, or only attaches to the host it lives on. */
export function isEnsuredEndpoint(ports: ChildEndpointPorts, endpoint: ChildEndpoint): boolean {
  return !endpoint.attachOnly && !attachOnlyEndpoint(endpoint.socket, ports.ownHostSocket(), ports.insideHost())
}

/** The sidecar's copy of the store list is informational: a failure is logged and noticed once. */
export async function recordSidecarStore(ports: ChildEndpointPorts, socket: string): Promise<void> {
  try {
    await registerSidecarStore({ socket, storeDir: ports.storeDir })
  } catch (error) {
    log("senpi-task shard sidecar store registration failed", { socket, error: String(error) })
    ports.notice("store_register_failed")
  }
}
