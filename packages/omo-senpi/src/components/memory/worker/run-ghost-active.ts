// Ghost active-reservation classification (post-#7095 repair lane, complementing the
// retired-generation rule in run-reconciliation.ts).
//
// Two wedge shapes survive that rule: a reservation whose launcher identity was never stamped
// (a legacy record no current code path writes, so no launcher can ever adopt it), and a run
// dir whose ledger provably predates the reservation but never reached a terminal artifact
// (the retired run crashed before settling). Both leave `active.lock` occupied forever, so
// every later reservation merges into pending and never launches. Classification only: the
// reclaim itself is the existing complete-as-failed + promote path, and retired artifacts are
// never touched.

import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import type { MemoryIdentity, ReservedRun } from "@oh-my-opencode/memory-core"

import { readRunJson } from "./run-artifacts"
import { parseReservationRunLedger } from "./reservation-run-ledger"

/** Generous attribution slack: reservation stamping and ledger writing are sequential same-host ops. */
export const RESERVATION_GENERATION_SLACK_MS = 5_000

export type GhostActiveReason = "missing-identity" | "older-ledger"

export type GhostActiveClassification =
  | { readonly ghost: false }
  | { readonly ghost: true; readonly reason: GhostActiveReason }

/**
 * A terminal run dir (final/abandoned present) is left to the retired-generation rule, which
 * owns terminal timestamp attribution. An unreadable ledger cannot prove a generation and is
 * therefore not a ghost.
 */
export async function classifyGhostActive(input: {
  readonly identity: MemoryIdentity
  readonly active: ReservedRun
}): Promise<GhostActiveClassification> {
  const { active } = input
  if (active.reservedAt === undefined || active.launcherPid === undefined || active.launcherHostname === undefined) {
    return { ghost: true, reason: "missing-identity" }
  }
  const runDir = join(input.identity.paths.reflection, "runs", active.runId)
  const ledgerPath = join(runDir, "ledger.json")
  if (!existsSync(ledgerPath)) return { ghost: false }
  if (existsSync(join(runDir, "final.json")) || existsSync(join(runDir, "abandoned.json"))) return { ghost: false }
  let startedAt: number
  try {
    startedAt = Date.parse(parseReservationRunLedger(await readRunJson<unknown>(ledgerPath)).startedAt)
  } catch {
    return { ghost: false }
  }
  const reservedAt = Date.parse(active.reservedAt)
  if (!Number.isFinite(startedAt) || !Number.isFinite(reservedAt)) return { ghost: false }
  return startedAt < reservedAt - RESERVATION_GENERATION_SLACK_MS
    ? { ghost: true, reason: "older-ledger" }
    : { ghost: false }
}
