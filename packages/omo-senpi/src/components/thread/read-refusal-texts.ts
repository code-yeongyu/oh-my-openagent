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
} as const satisfies Readonly<Record<`read.${string}`, RefusalText>>
