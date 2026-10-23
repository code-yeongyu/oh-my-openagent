import { agreementItemsOf, readAgreementsWorktree, renderAgreementsFile } from "../agreements/ledger-file"
import { applyAgreementRecords, type AgreementEvent } from "../agreements/mutate"
import type { AgreementExtractionRecord, AgreementsPolicy } from "../agreements/types"

export interface AgreementsTarget {
  /** The rendered ledger, or undefined when the records leave it byte-identical (stale reaffirms, refusals). */
  readonly content: string | undefined
  readonly events: readonly AgreementEvent[]
}

export async function renderAgreementsTarget(
  repoDir: string,
  records: readonly AgreementExtractionRecord[],
  policy: AgreementsPolicy,
): Promise<AgreementsTarget> {
  const existing = await readAgreementsWorktree(repoDir)
  const { items, events } = applyAgreementRecords(agreementItemsOf(existing), records, policy)
  const content = renderAgreementsFile(existing, items)
  return { content: content === existing ? undefined : content, events }
}
