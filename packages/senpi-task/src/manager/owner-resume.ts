import type { TaskRecord } from "../state"

/** An owner's answer on whether its settled child may reopen for a run the child started on its own. */
export type OwnerResumeVerdict =
  | { readonly kind: "allow" }
  // `retire` tears the child down (its claim is over); `hold` only stops the unsolicited turn and
  // leaves the settled child as resident and send-revivable as it was before it started that turn.
  | {
      readonly kind: "refuse"
      readonly reason: string
      readonly disposition: "retire" | "hold"
      // The owner's durable record of the refusal, run by the manager right after the record mutation
      // that refused (never inside it: the owner's write takes its own locks).
      readonly record?: () => void
    }
export type OwnerResumeFence = (record: TaskRecord) => OwnerResumeVerdict
