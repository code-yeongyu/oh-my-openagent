import type {
  MemoryIdentity,
  ReflectionOutcome,
  ReservedRun,
} from "@oh-my-opencode/memory-core"

import type { ReflectionReservationPort } from "./runner"
import type { ReflectionCompletionRecord } from "./completion"
import type { RunLivenessSeams } from "./run-liveness"

export type ReservationStatePort = ReflectionReservationPort & {
  readState(): Promise<{ readonly active?: ReservedRun }>
}

export interface RunFinalizationContext extends RunLivenessSeams {
  readonly identity: MemoryIdentity
  readonly reservation: ReservationStatePort
  readonly launch?: (run: ReservedRun) => void
  readonly now: () => number
  readonly withWriterLock?: <T>(operation: () => Promise<T>) => Promise<T>
}

export interface ReservationRunResult {
  readonly runId: string
  readonly outcome: ReflectionOutcome | "abandoned_unknown"
  readonly reason?: string
  readonly detail?: string
  readonly completion?: ReflectionCompletionRecord
  readonly launch?: ReservedRun
}

export interface DurableFinalizationDecision {
  readonly outcome: ReflectionOutcome
  readonly reason?: string
  readonly detail?: string
  readonly integrationSha?: string
}
