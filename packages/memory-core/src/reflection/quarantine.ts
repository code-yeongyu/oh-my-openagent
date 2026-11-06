import { join } from "node:path"

import type { ReservedRun } from "./machine"
import { writeJsonAtomic } from "./reservation-files"

export const QUARANTINE_FILENAME = "quarantined.json"
export const RESERVATION_EVIDENCE_FILENAME = "reservation.quarantined.json"

export type QuarantineReason =
  | "ledger_unreadable"
  | "prelaunch_missing_after_deadline"
  | "terminal_claim_unrecoverable"

export interface QuarantineRecord {
  readonly version: 1
  readonly runId: string
  readonly kind: "reflection" | "dream"
  readonly trigger: string
  readonly origin?: string
  /** `ledger.startedAt` when the ledger parses, else the reservation's `reservedAt`: never a fresh clock. */
  readonly generation: string
  readonly reason: QuarantineReason
  readonly quarantinedAt: string
  readonly evidence: readonly string[]
}

/** Evidence first, sentinel second; nothing already in the run dir is moved, rewritten or deleted. */
export async function writeQuarantine(runDir: string, record: QuarantineRecord, reservation?: ReservedRun): Promise<void> {
  if (reservation !== undefined) await writeJsonAtomic(join(runDir, RESERVATION_EVIDENCE_FILENAME), reservation)
  await writeJsonAtomic(join(runDir, QUARANTINE_FILENAME), record)
}
