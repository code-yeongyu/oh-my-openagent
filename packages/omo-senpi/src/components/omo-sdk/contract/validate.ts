import { Type } from "typebox"
import { Check } from "typebox/value"

import { ROOT_CALLS } from "./calls"
import { Principal } from "./principal"
import { SESSION_RESULTS } from "./results/custody"
import type { RootCallKey } from "./root"

const isCall = (key: string): key is RootCallKey => Object.hasOwn(ROOT_CALLS, key)

/**
 * Whether `input` is inside the input schema of the root call `key`; an unknown key accepts nothing. `exempt` names
 * fields whose values a scenario supplies at run time (an earlier call's answer): their own values are not checked,
 * but every other field of the input still is, and the input may not omit a field the schema requires.
 */
export const inputAccepts = (key: string, input: unknown, exempt: readonly string[] = []): boolean => {
  if (!isCall(key)) return false
  if (exempt.length === 0) return Check(ROOT_CALLS[key].input, input)
  const present = typeof input === "object" && input !== null && exempt.every((field) => Object.hasOwn(input, field))
  const rest = present ? Object.fromEntries(Object.entries(input).filter(([field]) => !exempt.includes(field))) : input
  return present && Check(Type.Omit(ROOT_CALLS[key].input, [...exempt]), rest)
}

/** Whether `value` is one of the five principals of the security design's section 3. */
export const isPrincipal = (value: unknown): boolean => Check(Principal, value)

/** Whether `value` is a valid answer of `call` to a session principal, where that answer differs from a person's. */
export const sessionAnswerAccepts = (call: keyof typeof SESSION_RESULTS, value: unknown): boolean =>
  Check(SESSION_RESULTS[call], value)
