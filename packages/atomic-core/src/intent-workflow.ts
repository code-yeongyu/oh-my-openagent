import type { AtomicClient } from "./client"
import type { AtomicCallOptions } from "./client-runner"
import type { AtomicConformance } from "./contracts"
import { AtomicError } from "./errors"

const ATTESTABLE_OMISSION = /^\[IntentShape\] \S+ (?:\(attributedTo\): author \(attributedTo\) must be present as a DID|\(proof\): intent must carry a Data Integrity proof)$/

export function requireAtomicConformance(verdict: AtomicConformance, operation: string, mutated: boolean): void {
  if (!verdict.conforms) {
    throw new AtomicError("review_blocked", {
      operation,
      sideEffectsPossible: mutated,
      diagnostic: verdict.violations.join("\n"),
    })
  }
}

export async function submitAtomicIntentReview(
  client: AtomicClient,
  call: AtomicCallOptions & { readonly id: string },
  mutate: <T>(action: () => Promise<T>) => Promise<T>,
) {
  const operation = "intent submit_review"
  await mutate(() => client.vaultSync(call))
  const initial = await client.intentValidate(call)
  if (!initial.conforms && !(initial.violations.length > 0 && initial.violations.every((entry) => ATTESTABLE_OMISSION.test(entry)))) {
    requireAtomicConformance(initial, operation, true)
  }
  requireAtomicConformance(await mutate(() => client.intentAttest(call)), operation, true)
  requireAtomicConformance(await client.intentValidate(call), operation, true)
  return mutate(() => client.intentUpdateStatus({ ...call, status: "needs-review" }))
}
