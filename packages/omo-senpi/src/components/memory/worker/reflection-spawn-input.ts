import { join } from "node:path"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { MemoryIdentity, ReflectionWorktree, ReservedRun } from "@oh-my-opencode/memory-core"

import { prepareReflectionForkSpawn, prepareReflectionSpawn } from "./spawn"
import { MEMORY_PRESSURE_SOFT_RATIO } from "../status"
import type { ReflectionModelCandidate } from "./resolve-model"
import type { RunAttempt } from "./run-artifacts"

type ReflectionSpawnInput = {
  readonly fork?: { readonly parentSessionFile: string; readonly parentCwd?: string }
  readonly run: ReservedRun
  readonly worktree: ReflectionWorktree
  readonly mergePolicy: "auto" | "integration"
  readonly category: string
  readonly candidate: ReflectionModelCandidate
  readonly attempt: number
  readonly hardDeadlineAt: number
  readonly nextAttempt?: RunAttempt
  readonly config: OmoConfig
  readonly identity: MemoryIdentity
  readonly env: NodeJS.ProcessEnv
  readonly senpiCommand?: string
  readonly senpiPrefixArgs?: readonly string[]
}

export function prepareReflectionCandidateSpawn(input: ReflectionSpawnInput) {
  const builder = input.fork === undefined ? prepareReflectionSpawn : prepareReflectionForkSpawn
  const systemTokenBudget = input.config.memory?.compile_warn_tokens ?? 30_000
  return builder({
    ...(input.fork === undefined
      ? {}
      : {
          parentSessionFile: input.fork.parentSessionFile,
          ...(input.fork.parentCwd === undefined ? {} : { parentCwd: input.fork.parentCwd }),
        }),
    run: input.run,
    worktree: input.worktree,
    reflectionSessionsDir: join(input.identity.paths.reflection, "runs"),
    category: input.category,
    model: input.candidate.model,
    thinking: input.candidate.thinking,
    attempt: input.attempt,
    hardDeadlineAt: input.hardDeadlineAt,
    nextAttempt: input.nextAttempt,
    env: input.env,
    mergePolicy: input.mergePolicy,
    skillsUsageSource: join(input.identity.paths.runtime, "skills-usage.json"),
    memoryUsageSource: join(input.identity.paths.runtime, "memory-usage.json"),
    dreamStateSource: join(input.identity.paths.runtime, "dream", "state.json"),
    peoplePolicy: {
      enabled: input.config.memory?.agents[input.identity.id]?.people?.enabled
        ?? input.config.memory?.people.enabled
        ?? true,
      max_entries: input.config.memory?.agents[input.identity.id]?.people?.max_entries
        ?? input.config.memory?.people.max_entries
        ?? 40,
      max_entry_chars: input.config.memory?.agents[input.identity.id]?.people?.max_entry_chars
        ?? input.config.memory?.people.max_entry_chars
        ?? 200,
    },
    systemTokenBudget,
    systemTokenTarget: Math.floor(MEMORY_PRESSURE_SOFT_RATIO * systemTokenBudget),
    senpiCommand: input.senpiCommand,
    senpiPrefixArgs: input.senpiPrefixArgs,
  })
}
