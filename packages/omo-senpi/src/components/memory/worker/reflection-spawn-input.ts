import { join } from "node:path"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { MemoryIdentity, ReflectionWorktree, ReservedRun } from "@oh-my-opencode/memory-core"

import { prepareReflectionSpawn } from "./spawn"
import type { ReflectionModelCandidate } from "./resolve-model"
import type { RunAttempt } from "./run-artifacts"

type ReflectionSpawnInput = {
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
}

export function prepareReflectionCandidateSpawn(input: ReflectionSpawnInput) {
  return prepareReflectionSpawn({
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
    senpiCommand: input.senpiCommand,
  })
}
