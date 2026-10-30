import { renderClaimReceipt, type ClaimReceipt } from "../provenance"

const RECEIPT_MARKER = /\s*\(source: (?:user replied "[^"\n]*" to proposal [0-9a-f]{16}; a record, not the user's approval|user said "[^"\n]*"(?: approving proposal [0-9a-f]{16})?|agent suggestion[^()\n]*(?:\([^()\n]*\)[^()\n]*)*|inferred[^()\n]*|mixed[^()\n]*)\)/g

export function factDisplayText(record: { readonly text: string; readonly receipt?: ClaimReceipt }): string {
  const text = stripReceiptSuffix(record.text)
  return record.receipt === undefined ? text : `${text} (source: ${renderClaimReceipt(record.receipt)})`
}

export function stripReceiptSuffix(content: string): string {
  return content.replace(RECEIPT_MARKER, "").trim()
}
