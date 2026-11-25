import { existsSync } from "node:fs"
import { homedir } from "node:os"
import {
  type StoreDependencies,
  type StoreRefusal,
  storeDisable,
  storeEnable,
  storeStatus,
  storeSwitchPort,
} from "../account-core/src/calls/store"
import { AUDIT_UNAVAILABLE_NOTE, processCustodyLog } from "../account-core/src/calls/custody-log"
import { desktopRuntimeCandidates } from "../account-core/src/keychain-helper/creator-handoff"
import { helperAccess } from "../account-core/src/keychain-helper/darwin-backend"
import { dedicatedStoreRoot, dedicatedStoreState } from "../account-core/src/keychain-helper/dedicated-store"
import { ACCOUNT_EXIT } from "./account-show"

// `omo account store status|enable|disable [--discard]` (#13116): the opt-in OmO keychain for a Mac whose login
// keychain stays locked. One JSON line on stdout like every `omo account` verb; the notes a person reads go to stderr.

export interface AccountStoreDependencies extends StoreDependencies {
  readonly desktopInstalled: () => boolean
  readonly output: (line: string) => void
  readonly error: (line: string) => void
}

const TRADE_OFF =
  "omo: OmO's own keychain keeps this Mac's sign-in readable while the login keychain is locked. Its key sits beside it with owner-only permissions, so other macOS users cannot read it, but anything running as you can, and a backup or disk image taken without FileVault exposes it. A restored Mac needs omo login again."

const DESKTOP_NOTE =
  "omo: the OmO desktop app on this Mac must also be a version that knows OmO's own keychain. An older desktop app keeps using the login keychain and can store a second sign-in there while someone is signed in at the screen."

const MOVE_NOTES: Readonly<Record<string, string>> = {
  "left-locked":
    "omo: the login keychain is locked, so any earlier sign-in there was left untouched. Run omo login to sign in to OmO's own keychain.",
  "left-unreadable":
    "omo: the login keychain holds a sign-in omo cannot read without a dialog, so it was left there. Run omo login to sign in to OmO's own keychain.",
}

export async function runAccountStore(deps: AccountStoreDependencies, flags: readonly string[]): Promise<number> {
  const [verb, ...rest] = flags
  const discard = rest.length === 1 && rest[0] === "--discard"
  const valid =
    (verb === "status" && rest.length === 0) ||
    (verb === "enable" && rest.length === 0) ||
    (verb === "disable" && (rest.length === 0 || discard))
  if (!valid) {
    deps.error("usage: omo account store status|enable|disable [--discard]")
    return ACCOUNT_EXIT.invalid
  }
  const port = storeSwitchPort(deps)
  if (verb === "status") {
    deps.output(JSON.stringify(storeStatus(port)))
    return ACCOUNT_EXIT.ok
  }
  if (verb === "disable") {
    const disabled = await storeDisable(port, { discard }, processCustodyLog())
    if (disabled.kind === "refused") return refusal(deps, disabled)
    const { auditUnavailable, ...value } = disabled.value
    if (auditUnavailable === true) deps.error(AUDIT_UNAVAILABLE_NOTE)
    if (value.damagedLeftInPlace === true)
      deps.error(
        `omo: OmO's own keychain was damaged, so it was turned off without being erased. Delete ${dedicatedStoreRoot()} yourself.`,
      )
    deps.output(JSON.stringify(value))
    return ACCOUNT_EXIT.ok
  }
  const enabled = await storeEnable(port, processCustodyLog())
  if (enabled.kind === "refused") return refusal(deps, enabled)
  const { auditUnavailable, ...value } = enabled.value
  if (auditUnavailable === true) deps.error(AUDIT_UNAVAILABLE_NOTE)
  deps.error(TRADE_OFF)
  if (deps.desktopInstalled()) deps.error(DESKTOP_NOTE)
  const note = MOVE_NOTES[value.moved]
  if (note !== undefined) deps.error(note)
  deps.output(JSON.stringify(value))
  return ACCOUNT_EXIT.ok
}

function refusal(deps: AccountStoreDependencies, refused: StoreRefusal): number {
  switch (refused.code) {
    case "macos_only":
      deps.error("omo account store: OmO's own keychain exists on macOS only.")
      return ACCOUNT_EXIT.invalid
    case "helper_unavailable":
      deps.error("omo account store: OmO's keychain helper is missing or failed its signature check. Reinstall omo.")
      return ACCOUNT_EXIT.storeUnavailable
    case "switch_failed":
      deps.error(`omo account store: ${refused.message}`)
      deps.output(JSON.stringify({ error: "store-switch", store: refused.store }))
      return ACCOUNT_EXIT.failed
  }
}

export const accountStoreDependencies = (
  api: string,
  io: Pick<AccountStoreDependencies, "output" | "error">,
): AccountStoreDependencies => ({
  api,
  platform: process.platform,
  state: () => dedicatedStoreState(),
  access: () => helperAccess("omo account store"),
  desktopInstalled: () => desktopRuntimeCandidates(homedir()).some(({ app }) => existsSync(app)),
  ...io,
})
