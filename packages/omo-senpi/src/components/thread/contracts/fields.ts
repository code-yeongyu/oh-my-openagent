import { Type } from "typebox"

export const THREAD_MESSAGE_MAX_BYTES = 32768
export const THREAD_SUMMARY_MAX_LENGTH = 200
export const THREAD_READ_DEFAULT_BYTES = 131072
export const THREAD_READ_MAX_BYTES = 1048576

export const ThreadAddress = Type.String({
  description:
    "Recipient thread id or unique name as returned by thread_list; a name shared by several threads returns ambiguous_target with candidates.",
})

export const AllScope = Type.Optional(
  Type.Boolean({
    description:
      "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied.",
  }),
)

export const IdempotencyKey = Type.Optional(
  Type.String({
    description:
      "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict.",
  }),
)

export const ExpectedTurnId = Type.Optional(
  Type.String({
    description:
      "Turn id the steer applies to; required with delivery steer, and a changed active turn returns turn_conflict with the message held undelivered.",
  }),
)

export const Summary = Type.Optional(
  Type.String({
    maxLength: THREAD_SUMMARY_MAX_LENGTH,
    description: "One-line preview shown to the caller when the completion notice arrives.",
  }),
)

export const Message = Type.String({
  maxLength: THREAD_MESSAGE_MAX_BYTES,
  description: `Instruction to deliver to the target thread; longer than ${THREAD_MESSAGE_MAX_BYTES} UTF-8 bytes returns message_too_large.`,
})

// R6: an enum instead of a boolean because delivery has three plausible states.
export const ThreadDeliveryMode = Type.Union([Type.Literal("auto"), Type.Literal("steer"), Type.Literal("follow_up")], {
  description:
    "auto steers the running turn when one is active and starts a new turn otherwise; steer requires expected_turn_id and becomes turn_conflict when the active turn changed; follow_up queues the message behind the running turn.",
})
