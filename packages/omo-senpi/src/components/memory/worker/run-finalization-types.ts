import type {
  MemoryIdentity,
  ReflectionOutcome,
  ReflectionParkTransition,
  ReflectionReservationLockOptions,
  ReservedRun,
} from "@oh-my-opencode/memory-core"

import type { MemoryReceiptsPort, ReceiptWarn } from "../receipts-port"
import type { ReflectionReservationPort } from "./runner"
import type { ReflectionCompletionRecord } from "./completion"
import type { RunLivenessSeams } from "./run-liveness"

export interface ReservationStatePort extends ReflectionReservationPort {
  readState(options?: ReflectionReservationLockOptions): Promise<{
    readonly active?: ReservedRun
    readonly pending?: ReservedRun
  }>
}

export interface RunFinalizationContext extends RunLivenessSeams {
  readonly identity: MemoryIdentity
  readonly reservation: ReservationStatePort
  readonly launch?: (run: ReservedRun) => void
  readonly now: () => number
  readonly withWriterLock?: <T>(operation: () => Promise<T>) => Promise<T>
  readonly receipts?: MemoryReceiptsPort
  readonly warn?: ReceiptWarn
}

export interface ReservationRunResult {
  readonly runId: string
  readonly outcome: ReflectionOutcome | "abandoned_unknown"
  readonly reason?: string
  readonly detail?: string
  readonly completion?: ReflectionCompletionRecord
  readonly launch?: ReservedRun
  readonly park?: ReflectionParkTransition
}

export interface DurableFinalizationDecision {
  readonly outcome: ReflectionOutcome
  readonly reason?: string
  readonly detail?: string
  readonly integrationSha?: string
  /** The supervisor died before publishing; its child's committed tip was validated and recovered. */
  readonly recoveredFromWorktree?: true
}
