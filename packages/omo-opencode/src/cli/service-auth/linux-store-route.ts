import { accountHome } from "./account-home"
import { withCredentialLock } from "./credential-lock"
import type { CredentialStorage, SealedStore } from "./keystore"
import type { StateFileStore } from "./state-file-store"

export type OpenKeyringState = "unlocked" | "absent" | "unknown"

const LIBSECRET_NOTICE =
  "omo: could not check whether the keyring is locked (gdbus or the Secret Service did not answer); using libsecret directly."

/**
 * Where the shared Linux sign-in lives (#7185b): the Secret Service whenever one exists, the private state file only
 * when none is on the session bus (or Bun has no OS store). A probe that cannot answer keeps an existing file in use
 * and otherwise asks libsecret, as before. Once the Secret Service answers unlocked, a state file moves into it under
 * the credential lock and is deleted only after the keyring returned exactly what was written.
 */
export function routeLinuxStore<T>(input: {
  readonly api: string
  readonly home?: string
  readonly keyring: SealedStore<T>
  readonly file: StateFileStore<T>
  /** Throws for a locked keyring, which never falls back to the file. */
  readonly probe: () => Promise<OpenKeyringState>
  /** Writes the stored text to the keyring and reads it back; throws, keeping the file, when either step fails. */
  readonly moveToKeyring: (text: string) => Promise<void>
  readonly notice: (message: string) => void
}): SealedStore<T> {
  const { keyring, file, notice } = input
  let storage: CredentialStorage = "keyring"
  let libsecretNoticed = false
  const migrate = () =>
    withCredentialLock(
      input.api,
      async () => {
        const text = await file.text()
        if (text === null) return
        await input.moveToKeyring(text)
        await file.clear()
      },
      input.home ?? accountHome(),
    )
  const choose = async (): Promise<CredentialStorage> => {
    const answer = await input.probe()
    if (answer === "absent") return "file"
    if (await file.present()) {
      if (answer === "unknown") return "file"
      await migrate()
      return "keyring"
    }
    if (answer === "unknown" && !libsecretNoticed) {
      libsecretNoticed = true
      notice(LIBSECRET_NOTICE)
    }
    return "keyring"
  }
  const target = async (): Promise<SealedStore<T>> => {
    storage = await choose()
    return storage === "file" ? file : keyring
  }
  return {
    read: async () => (await target()).read(),
    readAuthoritative: async () => (await target()).readAuthoritative(),
    write: async (value, intent, beforeRetire) => {
      const store = await target()
      if (store === file)
        notice(
          `omo: No keyring is running; OmO keeps this sign-in in a private file in ${file.directory()}, readable only by you. Start a keyring to keep it there instead.`,
        )
      await store.write(value, intent, beforeRetire)
    },
    // A sign-out removes the sign-in wherever it is: the file first, then the keyring item when a keyring may hold one.
    clear: async () => {
      const answer = await input.probe()
      await file.clear()
      storage = answer === "absent" ? "file" : "keyring"
      if (answer !== "absent") await keyring.clear()
    },
    storage: () => storage,
  }
}
