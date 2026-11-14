import { homedir } from "node:os"
import { loadTrustAnchor } from "../memory-core/src/sync/crypto/trust-pin.ts"
import {
  type CredentialStore,
  CredentialStoreError,
  credentialId,
  KeychainLockedError,
  SecretServiceUnavailableError,
} from "../omo-opencode/src/cli/service-auth/keystore"
import { type Credentials, SignInError } from "../omo-opencode/src/cli/service-auth/protocol"
import { readSignedOutMarker, signedOutMarkerPath } from "../omo-opencode/src/cli/service-auth/signed-out-marker"

// `omo account show`, apart from the verbs that sign in, refresh or hand keys over: it reads the stored credential, the
// signed-out marker and the sync pin, and nothing here reaches the account service (omo#13440).
// Exit 9 reports native storage failures/timeouts as {"error":"store-unavailable"} without another read.
// Exit 10 is exit 4 after an explicit `omo logout` (its marker, #11434): 4 alone may be a store that read empty.
export const ACCOUNT_EXIT = {
  ok: 0,
  failed: 1,
  invalid: 2,
  conflict: 3,
  signedOut: 4,
  ended: 5,
  uncertain: 6,
  keychainLocked: 7,
  keychainUnavailable: 8,
  storeUnavailable: 9,
  loggedOut: 10,
} as const

export interface AccountShowDependencies {
  readonly api: string
  readonly store: CredentialStore
  readonly home?: string
  readonly pinDir: () => string
  readonly output: (line: string) => void
  readonly error: (line: string) => void
}

const deviceOf = (credentials: Credentials) => ({ id: credentials.device.id, name: credentials.device.name })

const reply = (dependencies: AccountShowDependencies, value: unknown, code: number = ACCOUNT_EXIT.ok): number => {
  dependencies.output(JSON.stringify(value))
  return code
}

// A trust pin is written only after the device verified its membership, so a pin means this device
// joined memory sync for that account.
async function syncStateOf(pinDir: string, account: string): Promise<"joined" | "not_joined" | "corrupt_pin"> {
  const pin = await loadTrustAnchor(pinDir, account)
  if (pin.ok) return "joined"
  return pin.reason === "corrupt_pin" ? "corrupt_pin" : "not_joined"
}

const accountSignedOutMarker = (dependencies: Pick<AccountShowDependencies, "api" | "home">) =>
  readSignedOutMarker(signedOutMarkerPath(dependencies.home ?? homedir(), credentialId(dependencies.api)))

export async function showAccount(dependencies: AccountShowDependencies, flags: readonly string[]): Promise<number> {
  const current = await dependencies.store.read()
  const accountAt = flags.indexOf("--account")
  const account = accountAt === -1 ? undefined : flags[accountAt + 1]
  if (accountAt !== -1 && (account === undefined || account === "")) {
    dependencies.error("omo account show: --account needs an account id")
    return ACCOUNT_EXIT.invalid
  }
  const sync = account === undefined ? {} : { sync: await syncStateOf(dependencies.pinDir(), account) }
  const marker = current === null ? await accountSignedOutMarker(dependencies) : null
  return reply(
    dependencies,
    current === null
      ? { signedIn: false, ...(marker === null ? {} : { signedOut: marker }), ...sync }
      : { signedIn: true, device: deviceOf(current), refreshState: current.refreshState ?? "ok", ...sync },
  )
}

export function accountStoreFailure(dependencies: AccountShowDependencies, error: unknown): number {
  if (error instanceof KeychainLockedError) {
    dependencies.error(error.message)
    return reply(dependencies, { keychain: "locked" }, ACCOUNT_EXIT.keychainLocked)
  }
  if (error instanceof SecretServiceUnavailableError) {
    dependencies.error(error.message)
    return reply(dependencies, { keychain: "unavailable" }, ACCOUNT_EXIT.keychainUnavailable)
  }
  if (error instanceof CredentialStoreError) {
    dependencies.error(error.message)
    return reply(dependencies, { error: "store-unavailable" }, ACCOUNT_EXIT.storeUnavailable)
  }
  dependencies.error(
    error instanceof SignInError || error instanceof Error ? error.message : "omo account: the operation failed",
  )
  return ACCOUNT_EXIT.failed
}

/** `omo account show` with the account verbs' error mapping, without the modules that reach the account service. */
export async function runAccountShow(dependencies: AccountShowDependencies, flags: readonly string[]): Promise<number> {
  try {
    return await showAccount(dependencies, flags)
  } catch (error) {
    return accountStoreFailure(dependencies, error)
  }
}
