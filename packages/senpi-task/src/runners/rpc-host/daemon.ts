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
  type SenpiHostProtocolInfo,
  type TaskDaemonHostPort,
} from "../../lazy/senpi-barrel"
import {
  HostUnavailableError,
  TASK_DAEMON_CACHE_TTL_MS,
  TASK_DAEMON_PROTOCOL_VERSION,
  TASK_DAEMON_REQUIRED_CAPABILITIES,
  type EnsuredTaskDaemon,
  type EnsureTaskDaemonInput,
  type HostUnavailableReason,
  type LoadedDaemonLaunchSpec,
} from "./daemon-contract"
import { daemonLaunchOptions, daemonLaunchProfileId } from "./launch-options"
import { DAEMON_LAUNCH_SPEC_FILENAME, DaemonLaunchSpecError, readDaemonLaunchSpec } from "./launch-spec"
import { shareDaemonEnsure } from "./daemon-single-flight"
import { classifyEnsureFailure } from "./ensure-failure"
import { ensureHostClaimingOwner } from "./owner-claim"
import { writeStartedShardSidecar } from "./shard-sidecar"
import { log } from "@oh-my-opencode/utils"

// The daemon's launch surface is documented from this module: `omo daemon run` and a
// child-triggered ensure must reach the same producer.
export { daemonLaunchOptions, daemonLaunchProfileId }
export {
  HostUnavailableError,
  TASK_DAEMON_CACHE_TTL_MS,
  TASK_DAEMON_PROTOCOL_VERSION,
  TASK_DAEMON_REQUIRED_CAPABILITIES,
  TASK_HOST_SOCKET_ENV_NAMES,
  isHostIncompatible,
  resolveTaskHostSocket,
} from "./daemon-contract"
export type { DaemonLaunchOptions, DaemonLaunchOptionsInput } from "./launch-options"
export type {
  EnsuredTaskDaemon,
  EnsureTaskDaemonInput,
  HostUnavailableReason,
  LoadedDaemonLaunchSpec,
  TaskDaemonPorts,
} from "./daemon-contract"
export type { HostEnginePolicy }

interface DaemonCacheEntry {
  readonly socket: string
  readonly expiresAt: number
  readonly ensured: EnsuredTaskDaemon
  // The host generation the entry vouches for, when the ensure learned it.
  readonly hostInstanceId?: string
}

// One live entry per endpoint; a probe + decide round trip per child spawn would otherwise hit the
// socket on every task.
const cached = new Map<string, DaemonCacheEntry>()

/**
 * Drop the cached ensure for `socket`: its host was seen gone, so the next ensure probes again
 * instead of vouching for a dead endpoint until the TTL runs out. With `instanceId`, an entry that
 * already vouches for a different (newer) generation is kept.
 */
export function forgetTaskDaemon(socket: string, instanceId?: string): void {
  const entry = cached.get(socket)
  if (entry === undefined) return
  if (instanceId !== undefined && entry.hostInstanceId !== undefined && entry.hostInstanceId !== instanceId) return
  cached.delete(socket)
}

/**
 * Attach to the task host listening on `input.socket`, or create it from the launch spec. The engine owns every
 * protocol decision: omo probes, asks `decideHostAction`, and either calls `ensureHost` or fails
 * with a typed `HostUnavailableError`. It never signals, replaces or takes over a host (I1).
 */
export async function ensureTaskDaemon(input: EnsureTaskDaemonInput): Promise<EnsuredTaskDaemon> {
  const ports = input.ports ?? {}
  if ((ports.platform ?? process.platform) === "win32") {
    throw new HostUnavailableError("win32", { fallbackAllowed: true })
  }
  // Under Node the host cannot arm its child reaper (it needs `bun:ffi`), so children orphaned by a
  // terminated session worker stay zombies for the life of the host - measured on
  // every spawn API in todo 13's matrix. The per-child runner has no such path.
  if (!(ports.bunRuntimeAvailable ?? bunRuntimeAvailable(input.env))) {
    throw new HostUnavailableError("runtime", { fallbackAllowed: true })
  }

  const socket = input.socket
  const now = ports.now ?? Date.now
  const hit = cached.get(socket)
  if (hit !== undefined && hit.expiresAt > now()) return hit.ensured

  return shareDaemonEnsure(socket, () => ensureTaskDaemonOnce(input, socket, now))
}

async function ensureTaskDaemonOnce(
  input: EnsureTaskDaemonInput,
  socket: string,
  now: () => number,
): Promise<EnsuredTaskDaemon> {
  const ports = input.ports ?? {}
  const host = ports.host ?? (await loadTaskDaemonHostPort())
  const launchSpec = ports.launchSpec ?? loadDaemonLaunchSpec(ports.launchSpecPath)
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
    ...(input.owner === undefined ? {} : { owner: "caller" }),
    hostArgs: launch.hostArgs,
    env: launch.env,
    upgrade: launch.upgrade,
    policy: launch.policy,
  }
  const ensured = await ensureHostClaimingOwner(host, request).catch((error: unknown) => {
    throw new HostUnavailableError(classifyEnsureFailure(error), {
      fallbackAllowed: false,
      detail: sanitize(error),
    })
  })
  // A host that was already up answered the probe above; one this call started is asked once, so
  // the caller learns what it can do without opening a second connection of its own. That probe is
  // this ensure's last use of the host, so the engine's attach hold (senpi #2242) ends with it: the
  // daemon is transient, and a hold kept for the life of this omo process would stop its idle exit.
  // Children attach on their own connections. For an unowned host the idle window (minutes) covers
  // the gap; a caller-owned p-shard whose owner has already exited only gets the engine's short
  // quiescence grace (seconds), so a non-owner ensuring after that exit may find the host gone.
  let answered: SenpiHostProtocolInfo | undefined = running
  try {
    answered ??= await host.probeHost({ socket: ensured.socket })
  } finally {
    ensured.release?.()
  }
  const capabilities = answered?.capabilities
  // A handoff's probe answer names the predecessor, so only the engine's own answer counts there.
  const hostInstanceId = ensured.instanceId ?? (decision.action === "handoff" ? undefined : answered?.instanceId)
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
  if (decision.action === "start") await recordStartedEndpoint(input, ensured.socket, now)
  cached.set(socket, {
    socket,
    expiresAt: now() + TASK_DAEMON_CACHE_TTL_MS,
    ensured: result,
    ...(hostInstanceId === undefined ? {} : { hostInstanceId }),
  })
  return result
}

// The sidecar is informational (the agent-dir store index is authoritative), so a write failure is
// logged and never fails an ensure whose host is already up.
async function recordStartedEndpoint(input: EnsureTaskDaemonInput, socket: string, now: () => number): Promise<void> {
  try {
    await writeStartedShardSidecar({
      socket,
      now,
      pid: process.pid,
      ...(input.owner === undefined ? {} : { owner: input.owner }),
      ...(input.sidecarNotice === undefined ? {} : { notice: input.sidecarNotice }),
    })
  } catch (error) {
    log("senpi-task shard sidecar write failed", { socket, error: String(error) })
  }
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
function loadDaemonLaunchSpec(
  path = fileURLToPath(new URL(`../${DAEMON_LAUNCH_SPEC_FILENAME}`, import.meta.url)),
): LoadedDaemonLaunchSpec {
  try {
    return { path, spec: readDaemonLaunchSpec(path) }
  } catch (error) {
    // A refused spec is a typed, fixable host refusal (#9208), never a reason-less failure, and it
    // never falls back: the check stays exactly as strict as the reader makes it.
    if (error instanceof DaemonLaunchSpecError && error.code === "launch_spec_insecure") {
      throw new HostUnavailableError("launch_spec_insecure", { fallbackAllowed: false, launchSpecPath: path })
    }
    throw error
  }
}

/** omo-native `bun-runtime.js` semantics, POSIX half: this process is bun, or a bun is installed. */
function bunRuntimeAvailable(env: Readonly<Record<string, string | undefined>>): boolean {
  if (process.versions.bun !== undefined) return true
  const roots = [env["BUN_INSTALL"] ?? join(homedir(), ".bun"), join(homedir(), ".bun")]
  if (roots.some((root) => existsSync(join(root, "bin", "bun")))) return true
  return (env["PATH"] ?? "").split(":").some((entry) => entry !== "" && existsSync(join(entry, "bun")))
}

function hostUnavailableReason(reason: string): HostUnavailableReason {
  if (reason === "protocol" || reason === "capability" || reason === "legacy_host" || reason === "engine_mismatch") return reason
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
