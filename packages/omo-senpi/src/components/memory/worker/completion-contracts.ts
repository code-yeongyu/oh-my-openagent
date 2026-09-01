import type { EntryRenderer } from "@code-yeongyu/senpi"
import type { DreamOrigin, ReflectionOutcome, ReflectionTrigger } from "@oh-my-opencode/memory-core"

export const REFLECTION_COMPLETION_ENTRY_TYPE = "senpi-memory.reflection-completion"
export const REFLECTION_LAUNCHED_ENTRY_TYPE = "senpi-memory.reflection-launched"
export const REFLECTION_SUMMARY_ENTRY_TYPE = "senpi-memory.reflection-summary"

export interface ReflectionCompletionSummary {
  readonly schemaVersion: 1
  readonly count: number
  readonly failedCount: number
  readonly oldestISO: string
  readonly newestISO: string
  readonly dominantFingerprint: string
}

export interface ReflectionLaunchedEntry {
  readonly schemaVersion: 1
  readonly runId: string
  readonly identity: string
  readonly trigger: ReflectionTrigger
  readonly category: string
  readonly model?: string
  readonly thinking?: string
  readonly conversationIds: readonly string[]
  readonly backlogSteps: number
  readonly startedAt: string
}

export interface ReflectionCompletionRecord {
  readonly schemaVersion: 1
  readonly runId: string
  readonly identity: string
  readonly category: string
  readonly model?: string
  readonly thinking?: string
  readonly conversationIds: readonly string[]
  readonly trigger: ReflectionTrigger
  readonly origin?: DreamOrigin
  readonly outcome: ReflectionOutcome
  readonly reason?: string
  readonly detail?: string
  readonly startedAt: string
  /** Palace Reflection-tab contract: ISO completion timestamp used for newest-first ordering. */
  readonly finishedAt: string
  readonly durationMs?: number
  readonly mergedCommitSha?: string
  readonly filesChanged?: number
  readonly consecutiveFailures?: number
  readonly delivery: {
    readonly status: "pending" | "consumed"
    readonly sessionId?: string
    readonly consumedAt?: string
  }
}

export interface ReflectionCompletionApi {
  appendEntry<T = unknown>(customType: string, data?: T): void
  registerEntryRenderer<T>(customType: string, renderer: EntryRenderer<T>): void
}

export interface ReflectionCompletionUi {
  notify(message: string, level: "info" | "warning" | "error"): void
}

export interface ReflectionLiveSession {
  readonly sessionId: string
  readonly api: ReflectionCompletionApi
  readonly ui?: ReflectionCompletionUi
  readonly onCompletion?: (runId: string) => void | Promise<void>
  readonly logger?: {
    warn(message: string, details?: unknown): void
  }
}
