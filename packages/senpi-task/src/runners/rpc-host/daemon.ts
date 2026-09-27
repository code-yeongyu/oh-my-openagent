import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  loadSenpiBarrel,
  senpiDecideHostAction,
  senpiEngineBuildIdentity,
  senpiEnsureHost,
  senpiProbeHost,
  type EnsureHostInput,
  type HostEnginePolicy,
  type TaskDaemonHostPort,
} from "../../lazy/senpi-barrel"
import { daemonLaunchOptions, daemonLaunchProfileId } from "./launch-options"
import { DAEMON_LAUNCH_SPEC_FILENAME, readDaemonLaunchSpec, type DaemonLaunchSpec } from "./launch-spec"
import { shareDaemonEnsure } from "./daemon-single-flight"
import { classifyEnsureFailure } from "./ensure-failure"

// The daemon's launch surface is documented from this module: `omo daemon run` and a
// child-triggered ensure must reach the same producer.
export { daemonLaunchOptions, daemonLaunchProfileId }
export type { DaemonLaunchOptions, DaemonLaunchOptionsInput } from "./launch-options"
export type { HostEnginePolicy }

/**
 * Socket overrides, most specific first - the engine's own brand-prefixed `RPC_SOCKET` names, then
 * `OMO_RPC_SOCKET_PATH`, which the desktop sets on the host it spawns. Every omo client (the task
 * daemon here, the thread surface in omo-senpi) reads THIS list, so a socket that one of them
 * reaches is a socket all of them reach.
 */
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
  | "engine_mismatch"
  | "engine_refused"
  | "win32"
  | "runtime"
  | "host_unreachable"
  | "ensure_timed_out"
  | "ensure_failed"

/**
 * The daemon cannot host this child. `fallbackAllowed` marks the LOUD fallbacks to the per-child
 * runner: a pre-change or narrower daemon (`capability`), an engine the caller asked to fall back
 * from (`engine_mismatch`), win32 (no daemon runner path), and a Node runtime with no bun. Every
 * other reason fails fast - a refused client must never start a second host beside the daemon.
 */
export class HostUnavailableError extends Error {
  override readonly name = "HostUnavailableError"
  readonly reason: HostUnavailableReason
  readonly fallbackAllowed: boolean

  constructor(reason: HostUnavailableReason, options: { readonly fallbackAllowed: boolean; readonly detail?: string }) {
    super(`task daemon unavailable (${reason})${options.detail === undefined ? "" : `: ${options.detail}`}`)
    this.reason = reason
    this.fallbackAllowed = options.fallbackAllowed
  }
}

export interface LoadedDaemonLaunchSpec {
  readonly path: string
  readonly spec: DaemonLaunchSpec
}

export interface TaskDaemonPorts {
  readonly host?: TaskDaemonHostPort
  readonly launchSpec?: LoadedDaemonLaunchSpec
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
  // What this daemon advertises (`get_protocol_info.capabilities`). Absent only when a host this
  // call just started did not answer a probe - never guessed, because the `auto` execution mode is
  // decided from this list.
  readonly capabilities?: readonly string[]
}

interface DaemonCacheEntry {
  readonly socket: string
  readonly expiresAt: number
  readonly ensured: EnsuredTaskDaemon
}

// One daemon per machine means one live entry per process; a probe + decide round trip per child
// spawn would otherwise hit the socket on every task.
let cached: DaemonCacheEntry | undefined

/**
 * Attach to the machine-wide daemon, or create it from the launch spec. The engine owns every
 * protocol decision: omo probes, asks `decideHostAction`, and either calls `ensureHost` or fails
 * with a typed `HostUnavailableError`. It never signals, replaces or takes over a host (I1).
 */
export async function ensureTaskDaemon(input: EnsureTaskDaemonInput): Promise<EnsuredTaskDaemon> {
  const ports = input.ports ?? {}
  if ((ports.platform ?? process.platform) === "win32") {
    throw new HostUnavailableError("win32", { fallbackAllowed: true })
  }
  // Under Node the host cannot arm its child reaper (it needs `bun:ffi`), so children orphaned by a
  // terminated session worker stay zombies for the life of a machine-wide daemon - measured on
  // every spawn API in todo 13's matrix. The per-child runner has no such path.
  if (!(ports.bunRuntimeAvailable ?? bunRuntimeAvailable(input.env))) {
    throw new HostUnavailableError("runtime", { fallbackAllowed: true })
  }

  const socket = resolveTaskHostSocket(input.env, input.agentDir)
  const now = ports.now ?? Date.now
  if (cached !== undefined && cached.socket === socket && cached.expiresAt > now()) return cached.ensured

  return shareDaemonEnsure(socket, () => ensureTaskDaemonOnce(input, socket, now))
}

async function ensureTaskDaemonOnce(
  input: EnsureTaskDaemonInput,
  socket: string,
  now: () => number,
): Promise<EnsuredTaskDaemon> {
  const ports = input.ports ?? {}
  const host = ports.host ?? (await loadTaskDaemonHostPort())
  const launchSpec = ports.launchSpec ?? loadDaemonLaunchSpec()
  const launch = daemonLaunchOptions({
    spec: launchSpec.spec,
    specPath: launchSpec.path,
    parentEnv: input.env,
    idleExitMs: ports.idleExitMs ?? launchSpec.spec.tunables.idleExitMs,
    policy: input.policy,
  })

  const running = await host.probeHost({ socket })
  const decision = host.decideHostAction(
    {
      protocolVersion: TASK_DAEMON_PROTOCOL_VERSION,
      requiredCapabilities: TASK_DAEMON_REQUIRED_CAPABILITIES,
      identity: host.engineBuildIdentity(),
      launchProfileId: daemonLaunchProfileId(launchSpec.spec, launchSpec.path),
      startedByUs: false,
    },
    running,
    input.policy,
  )
  switch (decision.action) {
    case "refuse":
      throw new HostUnavailableError(hostUnavailableReason(decision.reason), {
        fallbackAllowed: decision.reason === "capability",
      })
    case "fallback":
      throw new HostUnavailableError(hostUnavailableReason(decision.reason), { fallbackAllowed: true })
    case "start":
    case "reuse":
    case "handoff":
      break
    default:
      return unreachable(decision.action)
  }

  const request: EnsureHostInput = {
    socket,
    agentDir: input.agentDir,
    hostArgs: launch.hostArgs,
    env: launch.env,
    upgrade: launch.upgrade,
    policy: launch.policy,
  }
  const ensured = await host.ensureHost(request).catch((error: unknown) => {
    throw new HostUnavailableError(classifyEnsureFailure(error), {
      fallbackAllowed: false,
      detail: sanitize(error),
    })
  })
  // A host that was already up answered the probe above; one this call started is asked once, so
  // the caller learns what it can do without opening a second connection of its own.
  const capabilities = running?.capabilities ?? (await host.probeHost({ socket: ensured.socket }))?.capabilities
  const result: EnsuredTaskDaemon = {
    action: decision.action,
    reason: decision.reason,
    socket: ensured.socket,
    pid: ensured.pid,
    reused: ensured.reused,
    upgradeable: decision.upgradeable,
    ...(ensured.instanceId === undefined ? {} : { instanceId: ensured.instanceId }),
    ...(ensured.engineVersion === undefined ? {} : { engineVersion: ensured.engineVersion }),
    ...(capabilities === undefined ? {} : { capabilities }),
  }
  cached = { socket, expiresAt: now() + TASK_DAEMON_CACHE_TTL_MS, ensured: result }
  return result
}

async function loadTaskDaemonHostPort(): Promise<TaskDaemonHostPort> {
  await loadSenpiBarrel()
  return {
    probeHost: senpiProbeHost(),
    decideHostAction: senpiDecideHostAction(),
    ensureHost: senpiEnsureHost(),
    engineBuildIdentity: senpiEngineBuildIdentity(),
  }
}

/**
 * The spec ships beside the plugin's extension bundles, so it is found relative to THIS module's
 * location inside `<pluginRoot>/extensions/` - the same contract `resolveMemberExtensionEntryPath`
 * relies on, and the reason both are only meaningful from the built plugin.
 */
function loadDaemonLaunchSpec(moduleUrl = import.meta.url): LoadedDaemonLaunchSpec {
  const path = fileURLToPath(new URL(`../${DAEMON_LAUNCH_SPEC_FILENAME}`, moduleUrl))
  return { path, spec: readDaemonLaunchSpec(path) }
}

/** omo-native `bun-runtime.js` semantics, POSIX half: this process is bun, or a bun is installed. */
function bunRuntimeAvailable(env: Readonly<Record<string, string | undefined>>): boolean {
  if (process.versions.bun !== undefined) return true
  const roots = [env["BUN_INSTALL"] ?? join(homedir(), ".bun"), join(homedir(), ".bun")]
  if (roots.some((root) => existsSync(join(root, "bin", "bun")))) return true
  return (env["PATH"] ?? "").split(":").some((entry) => entry !== "" && existsSync(join(entry, "bun")))
}

function hostUnavailableReason(reason: string): HostUnavailableReason {
  if (reason === "protocol" || reason === "capability" || reason === "engine_mismatch") return reason
  return "engine_refused"
}

function sanitize(error: unknown): string {
  const home = homedir()
  const raw = error instanceof Error ? error.message : String(error)
  const masked = home === "" ? raw : raw.replaceAll(home, "~")
  // Control bytes and stack newlines never reach the operator line the fallback warning carries.
  const flat = masked.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/ {2,}/g, " ").trim()
  return flat.length > 200 ? `${flat.slice(0, 200)}...` : flat
}

function unreachable(value: never): never {
  throw new Error(`unhandled host action: ${JSON.stringify(value)}`)
}
