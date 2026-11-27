import { Check } from "typebox/value"

import { ROOT_CALLS } from "./calls"
import { SESSION_RESULTS } from "./results/custody"
import type { RootCallKey } from "./root"

const isCall = (key: string): key is RootCallKey => Object.hasOwn(ROOT_CALLS, key)

/** Whether `input` is inside the input schema of the root call `key`; an unknown key accepts nothing. */
export const inputAccepts = (key: string, input: unknown): boolean => isCall(key) && Check(ROOT_CALLS[key].input, input)

export { isPrincipal } from "./principal"

/** Whether `value` is a valid answer of `call` to a session principal, where that answer differs from a person's. */
export const sessionAnswerAccepts = (call: keyof typeof SESSION_RESULTS, value: unknown): boolean =>
  Check(SESSION_RESULTS[call], value)
