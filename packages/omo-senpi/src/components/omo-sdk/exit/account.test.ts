import { expect, test } from "bun:test"

import {
  CredentialStoreError,
  DedicatedStoreError,
  InvalidCredentialState,
  KeychainApprovalPendingError,
  KeychainItemNotOwnedError,
  KeychainLockedError,
  SecretServiceUnavailableError,
} from "@oh-my-opencode/account-core/keystore"
import { ACCOUNT_EXIT, type AccountShowDependencies, accountStoreFailure } from "../../../../../omo-native/account-show"
import { type AccountStoreDependencies, runAccountStore } from "../../../../../omo-native/account-store"
import { failure as accessFailure } from "../access"
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
  ["account show", failure("credential_store_unavailable", "keychain_unavailable"), ACCOUNT_EXIT.keychainUnavailable],
  ["account store status", failure("invalid_arguments"), ACCOUNT_EXIT.invalid],
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

// The projection is a copy of the verbs' exits; these cases read the verbs themselves, so the copy cannot drift.
const quiet = { output: () => undefined, error: () => undefined }
const STORE_ERRORS = [
  new KeychainLockedError("locked"),
  new SecretServiceUnavailableError("no keychain"),
  new CredentialStoreError("unreadable"),
  new DedicatedStoreError("damaged"),
  new KeychainItemNotOwnedError("not owned"),
  new KeychainApprovalPendingError("pending"),
]
for (const route of ["account show", "account forget", "account store enable", "account store disable"])
  test.each(STORE_ERRORS.map((error) => [route, error.constructor.name, error] as const))(
    "#given %s #when the store throws %s #then the root's answer exits as the verb does",
    (_route, _name, error) => {
      const cli = accountStoreFailure(quiet as unknown as AccountShowDependencies, error)
      expect(exitOf(at(route), accessFailure(error))).toBe(cli)
    },
  )

test("#given account show and an unreadable stored sign-in #then the root's answer exits as the verb does", () => {
  const cli = accountStoreFailure(
    quiet as unknown as AccountShowDependencies,
    new InvalidCredentialState("cannot parse"),
  )
  expect(exitOf(at("account show"), failure("credential_store_unavailable", "unreadable_credential"))).toBe(cli)
})

test("#given account store with a malformed verb #then the root's invalid_arguments exits as the verb's usage error", async () => {
  const cli = await runAccountStore(quiet as unknown as AccountStoreDependencies, ["enable", "--bogus"])
  expect(cli).toBe(ACCOUNT_EXIT.invalid)
  expect(exitOf(at("account store enable"), failure("invalid_arguments"))).toBe(cli)
})
