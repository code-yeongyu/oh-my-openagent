import { join } from "node:path"

import type { HostEnginePolicy, TaskDaemonHostPort } from "../../lazy/senpi-barrel"
import type { DaemonLaunchSpec } from "./launch-spec"
import type { ShardOwner } from "./shard-sidecar"
import type { ShardNotice } from "./shard-socket"

export const TASK_HOST_SOCKET_ENV_NAMES = [
  "OMO_RPC_SOCKET",
  "SENPI_RPC_SOCKET",
  "PI_RPC_SOCKET",
  "OMO_RPC_SOCKET_PATH",
] as const

/** The ONE public socket of the machine-wide daemon: an override, else `<agentDir>/rpc/rpc.sock`. */
export function resolveTaskHostSocket(
  env: Readonly<Record<string, string | undefined>>,
  agentDir: string,
): string {
  for (const name of TASK_HOST_SOCKET_ENV_NAMES) {
    const configured = env[name]?.trim()
    if (configured) return configured
  }
  return join(agentDir, "rpc", "rpc.sock")
}

/** Capabilities a daemon must advertise before omo will run task children as its sessions. */
export const TASK_DAEMON_REQUIRED_CAPABILITIES = [
  "multi_session",
  "extension_events",
  "session_context",
  "session_kind",
] as const

/** The protocol generation this omo build speaks (senpi `get_protocol_info.protocolVersion`). */
export const TASK_DAEMON_PROTOCOL_VERSION = 1

/** How long an ensured daemon is trusted before the socket is probed again. */
export const TASK_DAEMON_CACHE_TTL_MS = 5_000

export type HostUnavailableReason =
  | "protocol"
  | "capability"
  | "legacy_host"
  | "engine_mismatch"
  | "engine_refused"
  | "win32"
  | "runtime"
  | "host_unreachable"
  | "ensure_timed_out"
  | "ensure_failed"
  | "host_busy"
  | "launch_spec_insecure"

export class HostUnavailableError extends Error {
  override readonly name = "HostUnavailableError"
  readonly reason: HostUnavailableReason
  readonly fallbackAllowed: boolean
  // The refused spec's path, computed by omo itself (never child output), so the public start
  // failure can name the file and its fix.
  readonly launchSpecPath?: string

  constructor(
    reason: HostUnavailableReason,
    options: { readonly fallbackAllowed: boolean; readonly detail?: string; readonly launchSpecPath?: string },
  ) {
    super(`task daemon unavailable (${reason})${options.detail === undefined ? "" : `: ${options.detail}`}`)
    this.reason = reason
    this.fallbackAllowed = options.fallbackAllowed
    if (options.launchSpecPath !== undefined) this.launchSpecPath = options.launchSpecPath
  }
}

const INCOMPATIBLE_REASONS: ReadonlySet<HostUnavailableReason> = new Set(["protocol", "capability", "legacy_host"])

export function isHostIncompatible(error: unknown): boolean {
  return error instanceof HostUnavailableError && INCOMPATIBLE_REASONS.has(error.reason)
}

export interface LoadedDaemonLaunchSpec {
  readonly path: string
  readonly spec: DaemonLaunchSpec
}

export interface TaskDaemonPorts {
  readonly host?: TaskDaemonHostPort
  readonly launchSpec?: LoadedDaemonLaunchSpec
  readonly launchSpecPath?: string
  readonly idleExitMs?: number
  readonly platform?: NodeJS.Platform
  readonly bunRuntimeAvailable?: boolean
  readonly now?: () => number
}

export interface EnsureTaskDaemonInput {
  readonly agentDir: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly policy: HostEnginePolicy
  readonly ports?: TaskDaemonPorts
  // The endpoint to attach to or start. Required: a task child has no machine-wide default, and the
  // operator endpoint `rpc.sock` is only ever reached by naming it.
  readonly socket: string
  readonly owner?: ShardOwner
  readonly sidecarNotice?: ShardNotice
}

export interface EnsuredTaskDaemon {
  readonly action: "start" | "reuse" | "handoff"
  readonly reason: string
  readonly socket: string
  readonly pid: number
  readonly reused: boolean
  readonly upgradeable: boolean
  readonly instanceId?: string
  readonly engineVersion?: string
  readonly capabilities?: readonly string[]
}
