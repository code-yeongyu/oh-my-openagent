import type { ReflectionChildResult } from "./spawn"
import {
  runMemoryModelAttempts,
  type MemoryModelAttempt,
  type MemoryModelChain,
} from "./memory-model-attempts"
import { preflightMemoryModels } from "./model-preflight"
import { resolveSenpiLaunch } from "./senpi-command"
import type { ReflectionModelCandidate } from "./resolve-model"
import type { RunAttempt } from "./run-artifacts"

export type MemoryLaunchSurface = "reflection" | "facts"

export type ResolveAndPreflightMemoryLaunchInput = {
  readonly candidates: MemoryModelChain
  readonly senpiCommand?: string
  readonly senpiPrefixArgs?: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly envFlag: "SENPI_MEMORY_REFLECTION" | "SENPI_MEMORY_FACTS"
  readonly configSources: readonly { readonly path: string; readonly exists: boolean }[]
  readonly warn?: (message: string, details?: unknown) => void
  readonly surfaceName: MemoryLaunchSurface
  readonly attempt: (
    candidate: ReflectionModelCandidate,
    attempt: number,
    nextAttempt: RunAttempt | undefined,
  ) => Promise<ReflectionChildResult>
}

export type ResolveAndPreflightMemoryLaunch = (
  input: ResolveAndPreflightMemoryLaunchInput,
) => Promise<MemoryModelAttempt>

export const resolveAndPreflightMemoryLaunch: ResolveAndPreflightMemoryLaunch = async (input) => {
  const launch = input.senpiCommand === undefined
    ? resolveSenpiLaunch(input.env)
    : { command: input.senpiCommand, prefixArgs: input.senpiPrefixArgs ?? [] }
  const preflight = await preflightMemoryModels({
    candidates: input.candidates,
    launch,
    env: {
      ...input.env,
      [input.envFlag]: "1",
      SENPI_PTY_FORCE_PIPE: "1",
    },
    configSources: input.configSources,
    warn: input.warn,
  })
  if (preflight.kind === "none_visible") {
    throw new Error(`No ${input.surfaceName} model candidate is visible to the discovery-disabled child: ${preflight.rejected.map((item) => `${item.model} (${item.cause})`).join(", ")}`)
  }
  return runMemoryModelAttempts(preflight.candidates, input.attempt)
}
