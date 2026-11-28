import type { ResolvedOmoAtomicPolicy } from "@oh-my-opencode/omo-config-core"

import { type AtomicClient, createAtomicClient, readAtomicVersion } from "./client"
import { type AtomicCallOptions, createAtomicRunner } from "./client-runner"
import type { AtomicVersion } from "./contracts"
import { AtomicError } from "./errors"
import { resolveAtomicExecutable } from "./executable"
import type { AtomicSpawn } from "./process"

export type AtomicCapabilities = {
  readonly mutations: boolean
  readonly recording: boolean
}

export type AtomicReadyProbe = {
  readonly kind: "ready"
  readonly client: AtomicClient
  readonly executable: string
  readonly version: AtomicVersion
  readonly compatibility: AtomicClient["compatibility"]
  readonly repositoryRoot: string
  readonly currentView: string
  readonly identity: "present" | "missing"
  readonly capabilities: AtomicCapabilities
  /** Agents whose Atomic-installed hooks are present; the recording owner decision reads this. */
  readonly hookInstalledAgents: readonly string[]
}

export type AtomicProbe =
  | { readonly kind: "disabled" }
  | { readonly kind: "unauthorized" }
  | AtomicReadyProbe
  | { readonly kind: "unavailable"; readonly error: AtomicError }

export type AtomicProbeOptions = {
  readonly cwd: string
  readonly policy: Pick<ResolvedOmoAtomicPolicy, "settings" | "authorized">
  readonly signal?: AbortSignal
  readonly spawn: AtomicSpawn
  /** The complete environment for Atomic subprocesses; PATH is read from it, never from the host process. */
  readonly environment: Readonly<Record<string, string>>
  readonly platform: NodeJS.Platform
}

const CURRENT_IDENTITY = /^Current identity: \S/m

async function readIdentity(binding: Parameters<typeof readAtomicVersion>[0], call: AtomicCallOptions) {
  const run = createAtomicRunner({ ...binding, compatibility: "degraded" })
  const stdout = await run({ operation: "identity whoami", args: ["identity", "whoami"], mutation: false }, call)
  return CURRENT_IDENTITY.test(stdout) ? "present" : "missing"
}

async function probeReady(options: AtomicProbeOptions): Promise<AtomicReadyProbe> {
  const executable = await resolveAtomicExecutable({
    binaryPath: options.policy.settings.binary_path,
    pathValue: options.environment["PATH"] ?? options.environment["Path"],
    cwd: options.cwd,
    platform: options.platform,
  })
  if (executable === undefined) {
    throw new AtomicError("binary_missing", { operation: "probe", sideEffectsPossible: false })
  }

  const binding = { executable, spawn: options.spawn, environment: options.environment }
  const call = { cwd: options.cwd, signal: options.signal }
  const version = await readAtomicVersion(binding, call)
  const client = createAtomicClient({ ...binding, version })
  const status = await client.status(call)
  const identity = await readIdentity(binding, call)
  const agents = await client.agentStatus(call)
  const fullySupported = client.compatibility === "supported" && options.platform !== "win32"

  return {
    kind: "ready",
    client,
    executable,
    version,
    compatibility: client.compatibility,
    repositoryRoot: status.repository_root,
    currentView: status.view,
    identity,
    capabilities: { mutations: fullySupported, recording: fullySupported },
    hookInstalledAgents: agents.agents.filter((agent) => agent.hooks_installed).map((agent) => agent.name),
  }
}

/** Never spawns Atomic unless a user-scoped layer enabled it. Integration failures become `unavailable`. */
export async function probeAtomic(options: AtomicProbeOptions): Promise<AtomicProbe> {
  if (!options.policy.settings.enabled) return { kind: "disabled" }
  if (!options.policy.authorized) return { kind: "unauthorized" }
  try {
    return await probeReady(options)
  } catch (error) {
    if (error instanceof AtomicError) return { kind: "unavailable", error }
    throw error
  }
}
