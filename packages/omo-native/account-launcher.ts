import { serviceAccountsOpen } from "../account-core/src/accounts-gate"
import { accountSignIn, type SignInRequest } from "../account-core/src/calls/sign-in"
import { createCredentialStore, type CredentialStore, INTERACTIVE_READ_WAIT } from "../account-core/src/keystore"
import { createSession } from "../account-core/src/session"
import { retireSyncPinOnDiscard } from "../account-core/src/sync-pin-retire"
import { resolveMemoryRoot } from "../memory-core/src/identity/layout"
import { syncPinDir } from "../memory-core/src/sync/pin-dir"
import type { AccountCommandDependencies } from "./account-cli"
import { cliDeviceServiceHandoff } from "./device-service-handoff"
import { setUpRemoteAfterSignIn } from "./remote-entry"

type Io = Pick<AccountCommandDependencies, "readStdin" | "output" | "error"> & { readonly log: (line: string) => void }

/** This machine's account as the launcher reaches it: its credential store, sync pin, device service and setup. */
export function launcherAccountDependencies(api: string, io: Io): AccountCommandDependencies {
  const pinDir = () => syncPinDir(resolveMemoryRoot(process.env, process.cwd()))
  // One store per command: its keyring check and fallback notice are per store (#10658 review).
  let store: CredentialStore | undefined
  return {
    api,
    get store() {
      store ??= createCredentialStore(api, { wait: INTERACTIVE_READ_WAIT })
      return store
    },
    pinDir,
    beforeKeysDiscarded: retireSyncPinOnDiscard({ pinDir, log: io.log }),
    deviceService: cliDeviceServiceHandoff({ api, log: io.log }),
    setUpDeviceService: () => setUpRemoteAfterSignIn(io.log),
    readStdin: io.readStdin,
    output: io.output,
    error: io.error,
  }
}

const silent = (): void => undefined

/**
 * account.signIn for the omo-ai/sdk entry (security design 5.4): the launcher's own sign-in, run in the caller's process
 * with exactly the dependencies `omo account sign-in` uses. Nothing is printed: the caller hears the codes through
 * onUserCode and the outcome through the answer.
 */
export function signInInLauncher(api: string, request: SignInRequest) {
  const deps = launcherAccountDependencies(api, {
    log: silent,
    output: silent,
    error: silent,
    readStdin: async () => "",
  })
  const session = createSession({
    api,
    store: deps.store,
    beforeKeysDiscarded: deps.beforeKeysDiscarded ?? (async () => undefined),
    ...(deps.deviceService === undefined ? {} : { deviceService: deps.deviceService }),
  })
  return accountSignIn(
    {
      api,
      session,
      store: deps.store,
      ...(deps.deviceService === undefined ? {} : { deviceService: deps.deviceService }),
      accountsOpen: serviceAccountsOpen(),
      ...(deps.setUpDeviceService === undefined ? {} : { setUpDeviceService: deps.setUpDeviceService }),
    },
    request,
  )
}
