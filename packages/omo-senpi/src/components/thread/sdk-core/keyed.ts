import { randomUUID } from "node:crypto"

import type { ThreadToolResult } from "../contracts"
import { answered } from "../control/operations"
import { createReceipts, type ReceiptScope, withReceiptExpiry } from "../control/receipts"
import type { GatewayStore } from "../gateway/store"

export type Retrying = { readonly error_note: string | null } | undefined

/**
 * The thread core's one receipt book (control/receipts.ts, the protocol the tools run): every call that takes an
 * `idempotency_key` admits, replays and settles through it, so a repeat under one key answers the first outcome and acts
 * once, and an answer to a call that named its key carries `receipt_expires_at` (#14951).
 */
export function createKeyed(
  store: GatewayStore,
  principal: string,
  now: () => number,
  onUnexpected: ((error: unknown) => unknown) | undefined,
) {
  const receipts = createReceipts(store, now, onUnexpected)
  return async function keyed(
    operation: ReceiptScope["operation"],
    value: unknown,
    key: string | undefined,
    body: (key: string, retrying: Retrying) => Promise<ThreadToolResult>,
  ): Promise<ThreadToolResult> {
    const named = key !== undefined && key.trim().length > 0
    const scope = { principal, operation, idempotency_key: named ? key.trim() : `call:${randomUUID()}` }
    const admission = await receipts.admit(scope, value, named)
    if (admission.kind === "answer") return admission.result
    let result: ThreadToolResult
    try {
      result = await answered(() => body(scope.idempotency_key, admission.retrying))
    } catch (error) {
      await receipts.fail(scope, error)
      throw error
    }
    await receipts.settle(scope, result, admission.retrying)
    return named ? withReceiptExpiry(result, admission.expires_at) : result
  }
}
