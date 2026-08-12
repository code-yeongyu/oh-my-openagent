import type { FactsPayload } from "@oh-my-opencode/memory-core"

import { runMemoryModelAttempts, type MemoryModelChain } from "./memory-model-attempts"
import { preflightMemoryModels } from "./model-preflight"
import type { ReflectionModelResolution } from "./resolve-model"
import { resolveSenpiLaunch } from "./senpi-command"
import {
  prepareFactsSpawn,
  runFactsChild,
  type FactsSandbox,
} from "./spawn"

type FactsChildLaunchInput = {
  readonly runId: string
  readonly runDir: string
  readonly payload: FactsPayload
  readonly resolution: Extract<ReflectionModelResolution, { readonly kind: "resolved" }>
  readonly env: NodeJS.ProcessEnv
  readonly configSources: readonly { readonly path: string; readonly exists: boolean }[]
  readonly warn?: (message: string, details?: unknown) => void
  readonly senpiCommand?: string
  readonly senpiPrefixArgs?: readonly string[]
  readonly hardDeadlineAt: number
  readonly terminationGraceMs?: number
  readonly maxOutputBytes?: number
  readonly sandbox?: FactsSandbox
  readonly supervisorPath?: string
  readonly batchId: string
  readonly queued: readonly { readonly conversationId: string; readonly end_message_id: string }[]
  readonly launchedAt: number
}

export async function launchFactsModelChain(input: FactsChildLaunchInput) {
  const candidates: MemoryModelChain = [
    {
      model: input.resolution.model,
      ...(input.resolution.thinking === undefined ? {} : { thinking: input.resolution.thinking }),
    },
    ...input.resolution.fallbacks,
  ]
  const launch = input.senpiCommand === undefined
    ? resolveSenpiLaunch(input.env)
    : { command: input.senpiCommand, prefixArgs: input.senpiPrefixArgs ?? [] }
  const preflight = await preflightMemoryModels({
    candidates,
    launch,
    env: { ...input.env, SENPI_MEMORY_FACTS: "1", SENPI_PTY_FORCE_PIPE: "1" },
    configSources: input.configSources,
    warn: input.warn,
  })
  if (preflight.kind === "none_visible") {
    throw new Error(`No facts model candidate is visible to the discovery-disabled child: ${preflight.rejected.map((item) => `${item.model} (${item.cause})`).join(", ")}`)
  }
  return runMemoryModelAttempts(preflight.candidates, async (candidate, attempt, nextAttempt) => {
    const spawnArgs = await prepareFactsSpawn({
      runId: input.runId,
      runDir: input.runDir,
      payload: input.payload,
      model: candidate.model,
      thinking: candidate.thinking,
      attempt,
      hardDeadlineAt: input.hardDeadlineAt,
      nextAttempt,
      env: input.env,
      senpiCommand: input.senpiCommand,
      senpiPrefixArgs: input.senpiPrefixArgs,
    })
    return runFactsChild(spawnArgs, {
      terminationGraceMs: input.terminationGraceMs,
      maxOutputBytes: input.maxOutputBytes,
      sandbox: input.sandbox,
      supervisorPath: input.supervisorPath,
      batchId: input.batchId,
      queued: input.queued,
      now: () => input.launchedAt,
    })
  })
}
