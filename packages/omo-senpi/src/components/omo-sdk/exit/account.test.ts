import { expect, test } from "bun:test"

import { ACCOUNT_EXIT } from "../../../../../omo-native/account-show"
import { exitOf, type SurfaceExits } from "."
import { SURFACE_EXITS } from "./surfaces"

// Design 4.4 for the account verbs (slice A1b): each account surface projects a failure to the exit its verb prints
// today (omo-native ACCOUNT_EXIT), keyed by the verb's CLI entry.

const failure = (code: string, reason?: string) =>
  ({ kind: "error", error: { code, ...(reason === undefined ? {} : { details: { reason } }) } }) as const
const at = (route: string) => SURFACE_EXITS[route] as SurfaceExits

test.each([
  ["account show", failure("credential_store_locked"), ACCOUNT_EXIT.keychainLocked],
  ["account show", failure("credential_store_unavailable"), ACCOUNT_EXIT.storeUnavailable],
  ["account show", failure("invalid_arguments"), ACCOUNT_EXIT.invalid],
  ["account sign-in", failure("already_signed_in"), ACCOUNT_EXIT.conflict],
  ["account sign-in", failure("machine_exists"), ACCOUNT_EXIT.conflict],
  ["account sign-in", failure("approval_denied"), ACCOUNT_EXIT.failed],
  ["account forget", failure("invalid_arguments", "other_device"), ACCOUNT_EXIT.conflict],
  ["account forget", failure("invalid_arguments", "empty_device"), ACCOUNT_EXIT.invalid],
  ["account forget", failure("credential_store_unavailable", "unreadable_credential"), ACCOUNT_EXIT.failed],
  ["account store enable", failure("unsupported", "macos_only"), ACCOUNT_EXIT.invalid],
  [
    "account store enable",
    failure("credential_store_unavailable", "helper_unavailable"),
    ACCOUNT_EXIT.storeUnavailable,
  ],
  ["account store disable", failure("credential_store_unavailable", "switch_failed"), ACCOUNT_EXIT.failed],
  ["login", failure("approval_denied"), 1],
  ["whoami", failure("signed_out"), 1],
] as const)("#given %s #when a failure is projected #then it exits as the verb prints today", (route, answer, exit) => {
  expect(exitOf(at(route), answer)).toBe(exit)
  expect(exitOf(at(route), { kind: "ok" })).toBe(ACCOUNT_EXIT.ok)
})
