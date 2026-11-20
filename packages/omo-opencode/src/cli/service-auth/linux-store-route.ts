import type { CredentialStorage, SealedStore } from "./keystore"
import type { StateFileStore } from "./state-file-store"

export type OpenKeyringState = "unlocked" | "absent" | "unknown"
/**
 * What the keyring holds next to a state file: nothing, the same sign-in with a token no fresher than the file's
 * ("older"), the same sign-in with a fresher token ("newer"), or another (or unreadable) sign-in.
 */
export type KeyringRelation = "empty" | "older" | "newer" | "other"

const LIBSECRET_NOTICE =
  "omo: could not check whether the keyring is locked (gdbus or the Secret Service did not answer); using libsecret directly."

/**
 * Where the shared Linux sign-in lives (#7185b): the Secret Service whenever one exists, the private state file only
 * when none is on the session bus (or Bun has no OS store). A probe that cannot answer keeps an existing file in use
 * and otherwise asks libsecret, as before. Once the Secret Service answers unlocked, a state file moves into it under
 * the credential lock, only over an empty slot or an older copy of the same sign-in, and is deleted only after the
 * keyring returned exactly what was written; a staler copy of the keyring's own sign-in is deleted, so an outdated
 * rotating refresh token never stays at rest (#13667). "No Secret Service" is per process (cron, su, ssh with no session
 * bus), so a file can hold a sign-in written beside one the keyring already holds: that keyring sign-in is never
 * replaced, and a file a sign-out here kept is never taken over here, so a sign-out never turns into another account.
 */
export function routeLinuxStore<T>(input: {
  /** The per-origin credential lock every process of this user takes (re-entrant within one async context). */
  readonly lock: <R>(action: () => Promise<R>) => Promise<R>
  readonly keyring: SealedStore<T>
  readonly file: StateFileStore<T>
  /** Throws for a locked keyring, which never falls back to the file. */
  readonly probe: () => Promise<OpenKeyringState>
  readonly relation: (text: string) => Promise<KeyringRelation>
  /** Writes the stored text to the keyring and reads it back; throws, keeping the file, when either step fails. */
  readonly moveToKeyring: (text: string) => Promise<void>
  readonly notice: (message: string) => void
}): SealedStore<T> {
  const { keyring, file, notice } = input
  let storage: CredentialStorage = "keyring"
  let libsecretNoticed = false
  let keptNoticed = false
  const keptLine = () =>
    `omo: the private sign-in file in ${file.directory()} holds a sign-in from a session that cannot reach the keyring; it is kept for that session and not used here.`
  const noticeLibsecret = (answer: OpenKeyringState) => {
    if (answer !== "unknown" || libsecretNoticed) return
    libsecretNoticed = true
    notice(LIBSECRET_NOTICE)
  }
  // Runs inside the credential lock only, so no sign-out can mark the file between this check and the move.
  const migrate = async (): Promise<void> => {
    if (await file.kept()) return
    const text = await file.text()
    if (text === null) return
    const relation = await input.relation(text)
    if (relation === "empty" || relation === "older") {
      await input.moveToKeyring(text)
      await file.clear()
      return
    }
    if (relation === "newer") {
      await file.clear()
      return
    }
    if (keptNoticed) return
    keptNoticed = true
    notice(
      `omo: the keyring already holds another OmO sign-in, which stays in use; the private sign-in file in ${file.directory()} is left as it is.`,
    )
  }
  // Inside the lock: whether a present file is marked, migrated or used, and the operation on that choice.
  const chooseUnderLock = async (answer: OpenKeyringState): Promise<CredentialStorage> => {
    if (!(await file.present())) {
      noticeLibsecret(answer)
      return "keyring"
    }
    if (await file.kept()) {
      if (!keptNoticed) {
        keptNoticed = true
        notice(keptLine())
      }
      noticeLibsecret(answer)
      return "keyring"
    }
    if (answer === "unknown") return "file"
    await migrate()
    return "keyring"
  }
  // A file nobody marked can be marked by a sign-out in another process at any moment, so once one is present the
  // choice and the operation run in one credential-lock hold (#13671 review L1); with no file, nothing to race.
  const run = async <R>(operation: (store: SealedStore<T>) => Promise<R>): Promise<R> => {
    const answer = await input.probe()
    if (answer === "absent") {
      storage = "file"
      return operation(file)
    }
    if (!(await file.present())) {
      storage = "keyring"
      noticeLibsecret(answer)
      return operation(keyring)
    }
    return input.lock(async () => {
      storage = await chooseUnderLock(answer)
      return operation(storage === "file" ? file : keyring)
    })
  }
  return {
    read: () => run((store) => store.read()),
    readAuthoritative: () => run((store) => store.readAuthoritative()),
    write: (value, intent, beforeRetire) =>
      run(async (store) => {
        if (store === file)
          notice(
            `omo: No keyring is running; OmO keeps this sign-in in a private file in ${file.directory()}, readable only by you. Start a keyring to keep it there instead.`,
          )
        await store.write(value, intent, beforeRetire)
      }),
    // A sign-out removes the sign-in this context uses. The file goes with a keyring item only when the keyring is empty
    // or holds that same sign-in; another sign-in in the file is not this context's to remove, so it is marked kept and
    // named once. The mark and the keyring delete happen in one lock hold, so no command can see the keyring empty while
    // the file is still unmarked (#13671 review L1).
    clear: async () => {
      const answer = await input.probe()
      if (answer === "absent") {
        storage = "file"
        return file.clear()
      }
      await input.lock(async () => {
        const present = await file.present()
        const kept = present && (await file.kept())
        if (answer === "unknown" && present && !kept) {
          storage = "file"
          return file.clear()
        }
        storage = "keyring"
        const text = present && !kept ? await file.text() : null
        if (text !== null) {
          if ((await input.relation(text)) !== "other") await file.clear()
          else {
            await file.markKept()
            keptNoticed = true
            notice(keptLine())
          }
        }
        await keyring.clear()
      })
    },
    storage: () => storage,
  }
}
