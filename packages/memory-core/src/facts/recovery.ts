import { readFile } from "../fs/resilient"
import { join } from "node:path"

import { agreementItemsOf, readAgreementsAt, readAgreementsWorktree } from "../agreements/ledger-file"
import { AGREEMENTS_PATH } from "../agreements/types"
import type { GitCommitAuthor, GitMemoryRepo, MemoryCommit } from "../git"
import { PROVENANCE_STRIPPED_TRAILER, strippedLegacyUserHeader } from "../tools/claim-frontmatter"
import type { FactsApplyRecovery } from "./mutation-plan"
import { FactsMutationTransaction, FactsOwnershipLostError } from "./recovery-mutation"
import { captureOwnedFactsState, sameFactsOwnedState } from "./recovery-ownership"

export type FactsRecoveryResult =
  | { readonly outcome: "committed"; readonly sha: string; readonly affectedPaths: readonly string[] }
  | { readonly outcome: "parent_dirty"; readonly detail?: string }

export async function findFactsBatchReceipt(
  repo: GitMemoryRepo,
  batchId: string,
): Promise<MemoryCommit | undefined> {
  return (await repo.log()).find((commit) => commit.trailers["Omo-Facts-Batch"] === batchId)
}

export async function applyFactsRecovery(
  repo: GitMemoryRepo,
  recovery: FactsApplyRecovery,
  recordCount: number,
  author: GitCommitAuthor,
): Promise<FactsRecoveryResult> {
  const observed = await captureOwnedFactsState(repo, recovery)
  if (observed === undefined) return { outcome: "parent_dirty" }
  const boundary = await captureOwnedFactsState(repo, recovery)
  if (boundary === undefined || !sameFactsOwnedState(observed, boundary)) return { outcome: "parent_dirty" }
  const transaction = new FactsMutationTransaction(repo, recovery, boundary)
  try {
    await transaction.restorePreState()
    await transaction.applyPostState()
    const result = await repo.commitPrepared(
      recovery.paths.map((entry) => entry.path),
      commitMessage(recovery.batchId, recordCount, await strippedHeaderPaths(repo, recovery), await evictedAgreementIds(repo, recovery)),
      author,
    )
    return { outcome: "committed", sha: result.sha, affectedPaths: recovery.paths.map((entry) => entry.path) }
  } catch (error) {
    await transaction.rollback()
    if (error instanceof FactsOwnershipLostError) return {
      outcome: "parent_dirty",
      ...(error.recoveryPath === undefined ? {} : { detail: `Foreign entry retained at ${error.recoveryPath}` }),
    }
    throw error
  }
}

// The facts lane removes an agreement only by evicting it at the cap; each removal is named in the commit.
async function evictedAgreementIds(repo: GitMemoryRepo, recovery: FactsApplyRecovery): Promise<readonly string[]> {
  if (!recovery.paths.some((entry) => entry.path === AGREEMENTS_PATH)) return []
  const after = new Set(agreementItemsOf(await readAgreementsWorktree(repo.dir)).map((item) => item.id))
  const before = agreementItemsOf(await readAgreementsAt(repo, recovery.headBeforeApply))
  return before.filter((item) => !after.has(item.id)).map((item) => item.id)
}

function commitMessage(batchId: string, count: number, stripped: readonly string[], evicted: readonly string[]): string {
  return [
    `chore(facts): extract ${count} ${count === 1 ? "fact" : "facts"}`,
    "",
    "Generated-By: facts-extractor",
    "Omo-Writer: facts-extractor",
    `Omo-Facts-Batch: ${batchId}`,
    ...stripped.map((path) => `${PROVENANCE_STRIPPED_TRAILER}: ${path}`),
    ...evicted.map((id) => `Omo-Agreement-Evicted: ${id}`),
  ].join("\n")
}

// The paths whose legacy user header this batch dropped, compared between the pre-state blob and the written file.
async function strippedHeaderPaths(repo: GitMemoryRepo, recovery: FactsApplyRecovery): Promise<string[]> {
  const before = await repo.readBlobs(recovery.paths.flatMap((entry) => (entry.pre.index === null ? [] : [entry.pre.index.oid])))
  const stripped: string[] = []
  for (const entry of recovery.paths) {
    const prior = entry.pre.index === null ? undefined : before.get(entry.pre.index.oid)
    const written = await readFile(join(repo.dir, entry.path), "utf8")
    if (strippedLegacyUserHeader(prior, written)) stripped.push(entry.path)
  }
  return stripped
}
