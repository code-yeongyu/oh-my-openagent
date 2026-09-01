import type { FactsApplyRecovery, FactsQueue, MemoryIdentity } from "@oh-my-opencode/memory-core"
import type { SenpiModelPort, SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"

import type { ComponentLogger } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import type { FactsFailurePort, FactsQueuedKey } from "./facts-failure-recording"
import type { ResolveAndPreflightMemoryLaunch } from "./worker/memory-launch-preflight"
import type { FactsSandbox } from "./worker/spawn"

export type FactsLaunchResult =
  | { readonly status: "empty" | "active" | "skipped" }
  | { readonly status: "committed"; readonly runId: string; readonly sha: string }
  | { readonly status: "no_facts" | "failed" | "parent_dirty"; readonly runId: string }

export interface FactsExtractorRunnerOptions {
  readonly identity: MemoryIdentity
  readonly queue?: FactsQueue
  readonly cwd: string
  readonly loadConfig: () => SenpiOmoConfigResult
  readonly resolveModelRegistry: () => SenpiModelRegistryPort<SenpiModelPort> | undefined
  readonly logger?: ComponentLogger
  readonly env?: NodeJS.ProcessEnv
  readonly deadlineMs?: number
  readonly terminationGraceMs?: number
  readonly maxOutputBytes?: number
  readonly senpiCommand?: string
  readonly senpiPrefixArgs?: readonly string[]
  readonly resolveAndPreflightLaunch?: ResolveAndPreflightMemoryLaunch
  readonly supervisorPath?: string
  readonly sandbox?: FactsSandbox
  readonly now?: () => Date
  readonly createBatchId?: () => string
  readonly withWriterLock?: <T>(operation: () => Promise<T>, attempt: number) => Promise<T>
  readonly retryDelay?: (attempt: number, delayMs: number) => Promise<void>
  readonly random?: () => number
  /** Failure-streak ledger seam; defaults to the durable `FactsFailureStore`. */
  readonly failures?: FactsFailurePort
  /** Terminal sentinel write seam; tests use it to crash inside the ordering window. */
  readonly writeTerminalSentinel?: (path: string, value: unknown) => Promise<void>
  /** Post-sentinel artifact deletion seam; tests observe the ordering and inject failures. */
  readonly removeRunArtifact?: (path: string) => Promise<void>
  readonly createPreflightId?: () => string
}

export interface FactsRunLedger {
  readonly version: 1
  readonly runId: string
  readonly attempt?: number
  readonly model?: string
  readonly thinking?: string
  readonly kind: "facts"
  readonly startedAt: string
  readonly hardDeadlineAt: number
  readonly terminationGraceMs: number
  readonly deadlineAt: number
  readonly batchId: string
  readonly queued: readonly FactsQueuedKey[]
  readonly headBeforeApply?: string
  readonly applyRecovery?: FactsApplyRecovery
  readonly pid?: number
  readonly processStart?: string | null
  readonly childPid?: number
  readonly childProcessStart?: string | null
}

export interface FactsFinalRecord {
  readonly version: 1
  readonly runId: string
  readonly outcome: "committed" | "no_facts" | "failed" | "parent_dirty"
  readonly sha?: string
}
