// The claim-receipt hooks register in the entry bundle; the verdict code ships as the `#omo-claim-receipt-runtime`
// sidecar, imported on the first finished answer.

import type * as ClaimReceiptRuntime from "./runtime"

export type ClaimReceiptRuntimeModule = Pick<typeof ClaimReceiptRuntime, "evaluateAnswer">
export type ClaimReceiptRuntimeLoader = () => Promise<ClaimReceiptRuntimeModule>

export const CLAIM_RECEIPT_RUNTIME_ARTIFACT = "extensions/omo-claim-receipt.js"

/** One shared import per process; a failed import is not cached, so the next answer retries. */
export function createClaimReceiptRuntimeLoader(importRuntime: () => Promise<ClaimReceiptRuntimeModule>): ClaimReceiptRuntimeLoader {
  let pending: Promise<ClaimReceiptRuntimeModule> | undefined
  return () => {
    pending ??= importRuntime().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}

export const loadClaimReceiptRuntime: ClaimReceiptRuntimeLoader = createClaimReceiptRuntimeLoader(() => import("#omo-claim-receipt-runtime"))

export function claimReceiptRuntimeLoadFailure(error: unknown): string {
  const cause = error instanceof Error ? error.message : String(error)
  return `omo-senpi claim-receipt skipped this answer: the claim-receipt runtime (${CLAIM_RECEIPT_RUNTIME_ARTIFACT}) failed to load: ${cause}. This build's plugin payload is incomplete; reinstall omo, then start a new session.`
}
