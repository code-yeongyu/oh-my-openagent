// The engine side of an ownership decision (#14491): counting the memory files a "use" uploads, writing the notice,
// and consuming a decision. Kept apart from ownership-decision.ts so the CLI never pulls the working-tree reader.

import { join } from "node:path"

import { readJson, removeAtomic, writeJson } from "./atomic"
import {
  DECISION_FILE,
  type OwnershipChoice,
  type OwnershipDecision,
  UNDECIDED_FILE,
  type UndecidedNotice,
} from "./ownership-decision"
import { itemPathsOnDisk } from "./working-tree"

export async function ownedFileCount(root: string): Promise<number> {
  return [...(await itemPathsOnDisk(root)).byKey.values()].filter((path) => path !== null).length
}

export async function writeUndecided(gitDir: string, root: string, account: string, now: number): Promise<void> {
  const notice: UndecidedNotice = { account, files: await ownedFileCount(root), at: now }
  await writeJson(join(gitDir, UNDECIDED_FILE), notice)
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
