import type { FactsPayload, ReflectionWorktree, ReservedRun } from "@oh-my-opencode/memory-core"

import type { FactsQueuedKey } from "../facts-failure-recording"
import type { RunAttempt } from "./run-artifacts"

export interface ReflectionSpawnPaths {
  readonly sessionDir: string
  readonly worktree: string
  readonly gitCommonDir: string
  readonly transcript: string
  readonly persona: string
  readonly prompt: string
  readonly skillsUsage?: string
  readonly memoryUsage?: string
  readonly dreamState?: string
  readonly dreamPolicy?: string
  readonly systemTokens?: string
  readonly dreamTarget?: string
}

export interface DreamPeoplePolicy {
  readonly enabled: boolean
  readonly max_entries: number
  readonly max_entry_chars: number
}

export interface ReflectionSpawnArgs {
  /** Fork mode reuses the parent session's request prefix so the provider cache can hit. */
  readonly fork?: {
    readonly parentSessionFile: string
  }
  readonly runId?: string
  readonly attempt: number
  readonly hardDeadlineAt: number
  readonly category: string
  readonly conversationIds: readonly string[]
  readonly model: string
  readonly thinking?: string
  readonly nextAttempt?: RunAttempt
  readonly kind?: "reflection" | "dream"
  readonly trigger?: ReservedRun["request"]["trigger"]
  readonly origin?: "manual" | "idle" | "shutdown" | "pressure"
  readonly mergePolicy?: "auto" | "integration"
  readonly targetDoc?: string
  readonly systemTokenBudget?: number
  readonly systemTokenTarget?: number
  readonly worktree?: ReflectionWorktree
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly detached: true
  readonly paths: ReflectionSpawnPaths
}

export type ReflectionSandbox = (
  spawnArgs: ReflectionSpawnArgs,
) => ReflectionSpawnArgs | Promise<ReflectionSpawnArgs>

export interface ReflectionChildResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export interface FactsSpawnArgs {
  readonly runId: string
  readonly attempt: number
  readonly hardDeadlineAt: number
  readonly model: string
  readonly thinking?: string
  readonly nextAttempt?: RunAttempt
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly detached: true
  readonly paths: {
    readonly runDir: string
    readonly payload: string
    readonly extraction: string
  }
}

export interface FactsRunLedgerEnvelope {
  readonly version: 1
  readonly runId: string
  readonly attempt: number
  readonly model: string
  readonly thinking?: string
  readonly kind: "facts"
  readonly startedAt: string
  readonly hardDeadlineAt: number
  readonly terminationGraceMs: number
  readonly deadlineAt: number
  readonly batchId: string
  readonly queued: readonly FactsQueuedKey[]
  readonly headBeforeApply?: string
}

export type FactsSandbox = (spawnArgs: FactsSpawnArgs) => FactsSpawnArgs | Promise<FactsSpawnArgs>

export interface PrepareReflectionSpawnInput {
  /** Fork mode: the live parent session file to fork, and the parent's cwd for prefix identity. */
  readonly parentSessionFile?: string
  readonly parentCwd?: string
  readonly run: ReservedRun
  readonly worktree: ReflectionWorktree
  readonly reflectionSessionsDir: string
  readonly category: string
  readonly model: string
  readonly thinking?: string
  readonly attempt?: number
  readonly hardDeadlineAt?: number
  readonly nextAttempt?: RunAttempt
  readonly env: NodeJS.ProcessEnv
  readonly mergePolicy: "auto" | "integration"
  readonly skillsUsageSource: string
  readonly memoryUsageSource: string
  readonly dreamStateSource: string
  readonly peoplePolicy: DreamPeoplePolicy
  readonly systemTokenBudget?: number
  readonly systemTokenTarget?: number
  readonly senpiCommand?: string
  readonly senpiPrefixArgs?: readonly string[]
  readonly chmodFile?: (path: string, mode: number) => Promise<void>
}

export interface PrepareFactsSpawnInput {
  readonly runId: string
  readonly runDir: string
  readonly payload: FactsPayload
  readonly model: string
  readonly thinking?: string
  readonly attempt?: number
  readonly hardDeadlineAt?: number
  readonly nextAttempt?: RunAttempt
  readonly env: NodeJS.ProcessEnv
  readonly senpiCommand?: string
  readonly senpiPrefixArgs?: readonly string[]
  readonly chmodFile?: (path: string, mode: number) => Promise<void>
}
