import { join } from "node:path"

import { writeJsonAtomic } from "./reservation-files"

const ABANDONED_FILENAME = "abandoned.json"

export type AbandonedReason = "launch_interrupted" | "processes_dead"

export interface AbandonedLauncher {
  readonly pid: number | undefined
  readonly hostname: string | undefined
  readonly processStart: string | null
}

export interface AbandonedRecord {
  readonly version: 1
  readonly runId: string
  readonly abandonedAt: string
  readonly reason: AbandonedReason
  /** The identity a receipt and a later backfill both compute: `ledger.startedAt`, else `reservedAt`. */
  readonly generation: string
  readonly kind: "reflection" | "dream"
  readonly trigger: string
  readonly origin?: string
  readonly launcher?: AbandonedLauncher
}

/** The terminal sentinel of a run that will never publish; nothing already in the run dir is touched. */
export async function writeAbandoned(runDir: string, record: AbandonedRecord): Promise<void> {
  await writeJsonAtomic(join(runDir, ABANDONED_FILENAME), record)
}
