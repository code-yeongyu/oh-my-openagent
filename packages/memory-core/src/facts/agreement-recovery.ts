import { AGREEMENTS_PATH, DEFAULT_AGREEMENTS_POLICY, type AgreementsPolicy } from "../agreements/types"
import type { GitMemoryRepo } from "../git"
import { renderAgreementsContent } from "./agreements-target"
import type { FactsBatch } from "./extraction"
import { factsRecordsHash, type FactsApplyRecovery } from "./mutation-plan"

export interface AgreementRecoveryInput {
  readonly batch: FactsBatch
  readonly agreementsPolicy?: AgreementsPolicy | undefined
  readonly publishRecovery?: ((recovery: FactsApplyRecovery) => Promise<void>) | undefined
}

// Ownership is checked against the ORIGINAL envelope before this replaces its old, non-deduplicated
// post-image. The transaction can then undo an interrupted old write and publish the migrated image.
export async function upgradeAgreementRecovery(
  repo: GitMemoryRepo,
  recovery: FactsApplyRecovery,
  input: AgreementRecoveryInput | undefined,
): Promise<FactsApplyRecovery> {
  if (recovery.agreementEventVersion === 1) return recovery
  const ledger = recovery.paths.find((entry) => entry.path === AGREEMENTS_PATH)
  if (ledger === undefined) return recovery
  if (input === undefined || input.publishRecovery === undefined || input.batch.batchId !== recovery.batchId
    || factsRecordsHash(input.batch.records, input.batch.agreements) !== recovery.recordsHash
    || input.batch.agreements === undefined) {
    throw new TypeError("Legacy agreement recovery requires its original records and an atomic recovery publisher")
  }
  const prior = ledger.pre.worktree
  const existing = prior.kind === "file" ? (await repo.readBlobs([prior.oid])).get(prior.oid) : undefined
  if (prior.kind === "file" && existing === undefined) throw new TypeError("Missing legacy agreement pre-image")
  const rendered = renderAgreementsContent(existing, input.batch.agreements, input.agreementsPolicy ?? DEFAULT_AGREEMENTS_POLICY)
  const content = rendered.content ?? existing
  if (content === undefined) throw new TypeError("Legacy agreement recovery has no ledger content")
  const post = {
    index: { ...ledger.post.index, oid: await repo.pathState.hashIndexBlob(AGREEMENTS_PATH, content, true) },
    worktree: { ...ledger.post.worktree, oid: await repo.pathState.hashWorktreeBlob(content, true) },
  }
  return { ...recovery, agreementEventVersion: 1, paths: recovery.paths.map((entry) => entry === ledger ? { ...entry, post } : entry) }
}
