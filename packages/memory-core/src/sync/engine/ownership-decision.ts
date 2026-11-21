// The person's answer to an older journal no record of the service can place (#14491 follow-up). While the engine
// cannot tell which account a device's memory belongs to, it writes a notice naming the signed-in account and how
// many memory files a "use" would upload; the person answers outside the engine (the CLI, the desktop) with a
// decision for that same account, and the engine applies it at its next cycle. "use" uploads memory across an
// account boundary, so it carries the file count the person was shown and is applied only while that count still
// holds; "set_aside" moves nothing off the device. A decision naming another account is never applied.

import { join } from "node:path"

import { readJson, removeAtomic, writeJson } from "./atomic"
import { itemPathsOnDisk } from "./working-tree"

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

async function ownedFileCount(root: string): Promise<number> {
  return [...(await itemPathsOnDisk(root)).byKey.values()].filter((path) => path !== null).length
}

export function readUndecided(gitDir: string): Promise<UndecidedNotice | null> {
  return readJson<UndecidedNotice | null>(join(gitDir, UNDECIDED_FILE), null)
}

export async function writeUndecided(gitDir: string, root: string, account: string, now: number): Promise<void> {
  const notice: UndecidedNotice = { account, files: await ownedFileCount(root), at: now }
  await writeJson(join(gitDir, UNDECIDED_FILE), notice)
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

/**
 * The decision the engine may apply now for `account`, consumed: a decision naming another account is dropped, and a
 * "use" whose confirmed count no longer matches the files on disk is dropped (the person must see the new count).
 */
export async function takeDecision(gitDir: string, root: string, account: string): Promise<OwnershipChoice | null> {
  const record = await readJson<OwnershipDecision | null>(join(gitDir, DECISION_FILE), null)
  if (record === null) return null
  await removeAtomic(join(gitDir, DECISION_FILE))
  if (record.account !== account) return null
  if (record.decision === "use" && record.files !== (await ownedFileCount(root))) return null
  return record.decision
}

export function clearUndecided(gitDir: string): Promise<void> {
  return removeAtomic(join(gitDir, UNDECIDED_FILE))
}
