import type { FactsPayload } from "@oh-my-opencode/memory-core"

import type { MemoryModelChain } from "./memory-model-attempts"
import {
  resolveAndPreflightMemoryLaunch,
  type ResolveAndPreflightMemoryLaunch,
} from "./memory-launch-preflight"
import type { ReflectionModelResolution } from "./resolve-model"
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
  readonly resolveAndPreflightLaunch?: ResolveAndPreflightMemoryLaunch
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
  return (input.resolveAndPreflightLaunch ?? resolveAndPreflightMemoryLaunch)({
    candidates,
    senpiCommand: input.senpiCommand,
    senpiPrefixArgs: input.senpiPrefixArgs,
    env: input.env,
    envFlag: "SENPI_MEMORY_FACTS",
    configSources: input.configSources,
    warn: input.warn,
    surfaceName: "facts",
    attempt: async (candidate, attempt, nextAttempt) => {
      console.error(`[facts-runner-trace] child:attempt:start attempt=${attempt} model=${candidate.model}`)
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
      console.error(`[facts-runner-trace] child:prepare:done attempt=${attempt}`)
      const child = await runFactsChild(spawnArgs, {
        terminationGraceMs: input.terminationGraceMs,
        maxOutputBytes: input.maxOutputBytes,
        sandbox: input.sandbox,
        supervisorPath: input.supervisorPath,
        batchId: input.batchId,
        queued: input.queued,
        now: () => input.launchedAt,
      })
      console.error(`[facts-runner-trace] child:attempt:done attempt=${attempt} code=${child.code}`)
      return child
    },
  })
}
