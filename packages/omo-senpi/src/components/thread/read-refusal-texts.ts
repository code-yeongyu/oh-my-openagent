import type { RefusalText } from "./refusal-texts"

/**
 * The bounded reads' refusal templates (read.*), composed into the one registry (`refusal-texts.ts`): a read's byte budget
 * that is not one, or that passes the cap. Each is the sentence the transcript reader built by hand before (#14951), byte
 * for byte.
 */
export const READ_TEXTS = {
  "read.max_bytes_invalid": {
    code: "invalid_arguments",
    message: "max_bytes must be a positive whole number; received {max_bytes}.",
    next_action: "Retry with max_bytes between 1 and {cap}, or omit it to take the default {default}.",
  },
  "read.max_bytes_over_cap": {
    code: "message_too_large",
    message: "max_bytes {max_bytes} exceeds the {cap}-byte hard cap.",
    next_action: "Re-read with max_bytes at most {cap} and follow next_cursor for the rest of the transcript.",
  },
  "read.after_not_found": {
    code: "not_found",
    message:
      "Item {after} is not among the items thread {thread} can read now: it is older than the readable window, it was rewritten away, or it belongs to another thread.",
    next_action:
      "Re-read the thread without after to take its newest items, then continue from an id that read returns.",
  },
  "read.after_with_cursor": {
    code: "invalid_arguments",
    message:
      "after and cursor cannot be passed together: after continues forward from an item, cursor pages older items.",
    next_action: "Pass only one of them.",
  },
  "read.after_unsupported": {
    code: "unsupported",
    message:
      "Thread {thread} is held by an engine that does not page its entries, so its items carry no id and a read cannot continue after one.",
    next_action: "Re-read the thread without after; update omo on the device that holds it to read by item id.",
  },
} as const satisfies Readonly<Record<`read.${string}`, RefusalText>>
