// The person's answer to an older journal no record of the service can place (#14491 follow-up). While the engine
// cannot tell which account a device's memory belongs to, it writes a notice naming the signed-in account and how
// many memory files a "use" would upload; the person answers outside the engine (the CLI, the desktop) with a
// decision for that same account, and the engine applies it at its next cycle. "use" uploads memory across an
// account boundary, so it carries the file count the person was shown and is applied only while that count still
// holds; "set_aside" moves nothing off the device. A decision naming another account is never applied. This module is
// only the notice and decision files (the CLI reads it); applying a decision lives in ownership-apply.ts.

import { join } from "node:path"

import { readJson, writeJson } from "./atomic"

export const UNDECIDED_FILE = "omo-sync-undecided.json"
export const DECISION_FILE = "omo-sync-ownership.json"

export interface UndecidedNotice {
  readonly account: string
  readonly files: number
  readonly at: number
}

export type OwnershipChoice = "use" | "set_aside"

export interface OwnershipDecision {
  readonly account: string
  readonly decision: OwnershipChoice
  readonly files: number
}

export type DecideResult =
  | { readonly kind: "recorded" }
  | { readonly kind: "not_undecided" }
  | { readonly kind: "other_account"; readonly account: string }
  | { readonly kind: "changed"; readonly files: number }

export function readUndecided(gitDir: string): Promise<UndecidedNotice | null> {
  return readJson<UndecidedNotice | null>(join(gitDir, UNDECIDED_FILE), null)
}

/**
 * Records the person's decision for the repository whose engine is waiting on one. Refuses unless that engine's notice
 * names the same account and, for "use", the same file count the person confirmed.
 */
export async function decideOwnership(
  gitDir: string,
  account: string,
  decision: OwnershipChoice,
  confirmedFiles: number,
): Promise<DecideResult> {
  const notice = await readUndecided(gitDir)
  if (notice === null) return { kind: "not_undecided" }
  if (notice.account !== account) return { kind: "other_account", account: notice.account }
  if (decision === "use" && notice.files !== confirmedFiles) return { kind: "changed", files: notice.files }
  const record: OwnershipDecision = { account, decision, files: confirmedFiles }
  await writeJson(join(gitDir, DECISION_FILE), record)
  return { kind: "recorded" }
}
