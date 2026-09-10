import type { ReflectionWorktree, ReservedRun } from "@oh-my-opencode/memory-core"
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
