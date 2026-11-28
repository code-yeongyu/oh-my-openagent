import { type AtomicAgentOperations, createAgentOperations } from "./client-agent"
import { type AtomicIntentOperations, createIntentOperations } from "./client-intent"
import { type AtomicQueryOperations, createQueryOperations } from "./client-query"
import { type AtomicCallOptions, createAtomicRunner } from "./client-runner"
import { type AtomicVaultOperations, createVaultOperations } from "./client-vault"
import { type AtomicVcsOperations, createVcsOperations } from "./client-vcs"
import { type AtomicCompatibility, type AtomicVersion, classifyAtomicVersion, parseAtomicVersion } from "./contracts"
import { AtomicError } from "./errors"
import type { AtomicSpawn } from "./process"

export type AtomicProcessBinding = {
  readonly executable: string
  readonly spawn: AtomicSpawn
  readonly environment: Readonly<Record<string, string>>
}

export type AtomicClient = AtomicVcsOperations &
  AtomicQueryOperations &
  AtomicVaultOperations &
  AtomicIntentOperations &
  AtomicAgentOperations & {
    readonly executable: string
    readonly version: AtomicVersion
    readonly compatibility: Exclude<AtomicCompatibility, "unsupported">
  }

export async function readAtomicVersion(binding: AtomicProcessBinding, call: AtomicCallOptions): Promise<AtomicVersion> {
  const run = createAtomicRunner({ ...binding, compatibility: "degraded" })
  const stdout = await run({ operation: "version", args: ["--version"], mutation: false }, call)
  const version = parseAtomicVersion(stdout)
  if (version === undefined) {
    throw new AtomicError("invalid_response", {
      operation: "version",
      sideEffectsPossible: false,
      message: "atomic --version did not print 'atomic <major>.<minor>.<patch>'",
      diagnostic: stdout,
    })
  }
  return version
}

export function createAtomicClient(options: AtomicProcessBinding & { readonly version: AtomicVersion }): AtomicClient {
  const compatibility = classifyAtomicVersion(options.version)
  if (compatibility === "unsupported") {
    throw new AtomicError("version_unsupported", {
      operation: "version",
      sideEffectsPossible: false,
      message: `atomic ${options.version.text} is older than the supported 0.22.1`,
    })
  }
  const run = createAtomicRunner({ ...options, compatibility })
  return {
    executable: options.executable,
    version: options.version,
    compatibility,
    ...createVcsOperations(run),
    ...createQueryOperations(run),
    ...createVaultOperations(run),
    ...createIntentOperations(run),
    ...createAgentOperations(run),
  }
}
