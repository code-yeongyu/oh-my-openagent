import { ACCOUNT_CALLS } from "./calls/account"
import { AUTHORITY_CALLS } from "./calls/authority"
import { ENGINE_CALLS } from "./calls/engine"
import { HOST_CALLS } from "./calls/host"
import { THREAD_CALLS } from "./calls/threads"

// Every call of the root, keyed by its registry row's `sdk`: the one table the root's type is computed from.
export const ROOT_CALLS = {
  ...THREAD_CALLS,
  ...ACCOUNT_CALLS,
  ...HOST_CALLS,
  ...ENGINE_CALLS,
  ...AUTHORITY_CALLS,
} as const
