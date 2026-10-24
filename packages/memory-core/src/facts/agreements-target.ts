import { agreementItemsOf, readAgreementsWorktree, renderAgreementsFile } from "../agreements/ledger-file"
import { applyAgreementRecords, type AgreementEvent } from "../agreements/mutate"
import type { AgreementExtractionRecord, AgreementsPolicy } from "../agreements/types"
import { parseAgreementsLedger } from "../agreements/format"
import { parseMemoryFile } from "../memfs"

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
  return renderAgreementsContent(existing, records, policy)
}

export function renderAgreementsContent(
  existing: string | undefined,
  records: readonly AgreementExtractionRecord[],
  policy: AgreementsPolicy,
): AgreementsTarget {
  const priorReceipts = existing === undefined ? [] : parseAgreementsLedger(parseMemoryFile(existing).body).receipts
  const { items, events, receipts } = applyAgreementRecords(agreementItemsOf(existing), records, policy, priorReceipts)
  const content = renderAgreementsFile(existing, items, receipts)
  return { content: content === existing ? undefined : content, events }
}
