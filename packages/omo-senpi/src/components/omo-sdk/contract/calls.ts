import { THREAD_CALLS } from "./calls/threads"

// Every call of the root, keyed by its registry row's `sdk`: the one table the root's type is computed from.
export const ROOT_CALLS = {
  ...THREAD_CALLS,
} as const
