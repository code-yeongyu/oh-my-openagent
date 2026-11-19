import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { credentialId } from "../omo-opencode/src/cli/service-auth/keystore"
import { withCredentialLock } from "../omo-opencode/src/cli/service-auth/credential-lock"
import type { HelperAccess } from "../omo-opencode/src/cli/service-auth/keychain-helper/access"
import { desktopRuntimeCandidates } from "../omo-opencode/src/cli/service-auth/keychain-helper/creator-handoff"
import { helperAccess } from "../omo-opencode/src/cli/service-auth/keychain-helper/darwin-backend"
import {
  type DedicatedStoreState,
  dedicatedStoreRoot,
  dedicatedStoreState,
} from "../omo-opencode/src/cli/service-auth/keychain-helper/dedicated-store"
import { StoreSwitchError, storeSwitch } from "../omo-opencode/src/cli/service-auth/keychain-helper/dedicated-switch"
import { ACCOUNT_EXIT } from "./account-show"

// `omo account store status|enable|disable [--discard]` (#13116): the opt-in OmO keychain for a Mac whose login
// keychain stays locked. One JSON line on stdout like every `omo account` verb; the notes a person reads go to stderr.

export interface AccountStoreDependencies {
  readonly api: string
  readonly platform: NodeJS.Platform
  readonly state: () => DedicatedStoreState
  readonly access: () => Promise<HelperAccess>
  readonly desktopInstalled: () => boolean
  readonly home?: string
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
  const state = deps.platform === "darwin" ? deps.state() : "absent"
  if (verb === "status") {
    deps.output(JSON.stringify({ store: state === "active" ? "omo" : "login", state, path: dedicatedStoreRoot() }))
    return ACCOUNT_EXIT.ok
  }
  if (deps.platform !== "darwin") {
    deps.error("omo account store: OmO's own keychain exists on macOS only.")
    return ACCOUNT_EXIT.invalid
  }
  const access = await deps.access()
  if (access.kind !== "ready") {
    deps.error("omo account store: OmO's keychain helper is missing or failed its signature check. Reinstall omo.")
    return ACCOUNT_EXIT.storeUnavailable
  }
  const locked = <T>(run: (switcher: ReturnType<typeof storeSwitch>) => Promise<T>): Promise<T> =>
    withCredentialLock(
      deps.api,
      (lease) => run(storeSwitch({ access, account: credentialId(deps.api), lease, state: deps.state })),
      deps.home,
    )
  try {
    if (verb === "disable") {
      const disabled = await locked((switcher) => switcher.disable(discard))
      if (disabled.damagedLeftInPlace === true)
        deps.error(
          `omo: OmO's own keychain was damaged, so it was turned off without being erased. Delete ${dedicatedStoreRoot()} yourself.`,
        )
      deps.output(JSON.stringify({ store: "login", ...disabled }))
      return ACCOUNT_EXIT.ok
    }
    const enabled = await locked((switcher) => switcher.enable())
    deps.error(TRADE_OFF)
    if (deps.desktopInstalled()) deps.error(DESKTOP_NOTE)
    const note = MOVE_NOTES[enabled.moved]
    if (note !== undefined) deps.error(note)
    deps.output(JSON.stringify({ store: "omo", ...enabled }))
    return ACCOUNT_EXIT.ok
  } catch (error) {
    if (!(error instanceof StoreSwitchError)) throw error
    deps.error(`omo account store: ${error.message}`)
    deps.output(JSON.stringify({ error: "store-switch", store: deps.state() === "active" ? "omo" : "login" }))
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
  access: helperAccess,
  desktopInstalled: () => desktopRuntimeCandidates(homedir()).some(({ app }) => existsSync(app)),
  ...io,
})
