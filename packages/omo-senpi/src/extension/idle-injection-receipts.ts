export type ReceiptErrors = { readonly threw: boolean; readonly first: unknown; readonly rest: readonly unknown[] }

export const NO_RECEIPT_ERRORS: ReceiptErrors = { threw: false, first: undefined, rest: [] }

// Runs one receipt per producer, each in its own try, and returns every error: one producer's throwing receipt
// must never cost a later producer its receipt, or that producer's completion is never recorded or redelivered.
// `threw` is set in the catch block, never from the caught value, so a thrown undefined, null, 0 or '' still counts.
export function runReceipts<T>(targets: readonly T[], receipt: (target: T) => void): ReceiptErrors {
  let threw = false
  let first: unknown
  const rest: unknown[] = []
  for (const target of targets) {
    try {
      receipt(target)
    } catch (error) {
      if (threw) rest.push(error)
      else first = error
      threw = true
    }
  }
  return { threw, first, rest }
}
