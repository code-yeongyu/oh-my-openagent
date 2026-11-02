import { createHash, randomUUID } from "node:crypto"
import { basename } from "node:path"
import type { z } from "zod"
import { signInRoute } from "./accounts-gate"
import { credentialSchema, type Credentials, serviceOrigin, SignInError } from "./protocol"
import { probeSecretServiceLock, type SecretServiceLockProbe } from "./secret-service-lock"
import { withCredentialLock } from "./credential-lock"

type SecretKey = { readonly service: string; readonly name: string }
export type SecretApi = {
  readonly get: (key: SecretKey) => Promise<string | null>
  readonly set: (key: SecretKey & { readonly value: string }) => Promise<void>
  readonly delete: (key: SecretKey) => Promise<boolean>
}
export type SealedStore<T> = {
  readonly read: () => Promise<T | null>
  /** A read started now that never joins a coalesced read begun earlier; credential transactions use it under the lock. */
  readonly readAuthoritative: () => Promise<T | null>
  readonly write: (value: T) => Promise<void>
  readonly clear: () => Promise<void>
}
export type CredentialStore = SealedStore<Credentials>

export class CredentialStoreError extends SignInError {}
export class KeychainLockedError extends CredentialStoreError {}
export class SecretServiceUnavailableError extends CredentialStoreError {}
export class InvalidCredentialState extends SignInError {}
/** The stored credential is no longer the identity and generation a caller captured. */
export class CredentialIdentityChanged extends Error {
  constructor() { super("The stored sign-in changed; the captured account is no longer current.") }
}
/** The OS store has not answered a read in time: it is waiting on a person (a keychain approval dialog, #11262). */
export class KeychainApprovalPendingError extends CredentialStoreError {}

/**
 * How long a read waits for an OS store that has not answered. An unanswered approval dialog blocks the native read
 * with no end, so a session path (memory sync, the memory tool, a host's token) gives up at a deadline and an
 * interactive command keeps waiting but says why.
 */
export type CredentialReadWait =
  | { readonly kind: "bounded"; readonly deadlineMs: number }
  | { readonly kind: "interactive"; readonly noticeAfterMs: number; readonly notice: (message: string) => void }

// A healthy read answers in tens of milliseconds (a whole `omo account show` took 68 ms in #11262; 64 parallel
// lookups settled in about 25 ms), so 5 s is far past any healthy read and far shorter than a person answering a dialog.
export const SESSION_READ_WAIT: CredentialReadWait = { kind: "bounded", deadlineMs: 5_000 }
export const INTERACTIVE_READ_WAIT: CredentialReadWait = {
  kind: "interactive",
  noticeAfterMs: 2_000,
  notice: message => process.stderr.write(`${message}\n`),
}

// One OS read per credential per process: a read the OS has not answered is shared by every later caller, so an open
// dialog holds one parked native read and one prompt, never one more per sync request, even after deadlines expire.
// Settled answers are never cached: another process can rotate the single-use token before the next read.
const processReads = new WeakMap<SecretApi, Map<string, Promise<string | null>>>()

// The OS store refused because it is locked and may not ask the person (macOS errSecInteractionNotAllowed,
// a locked libsecret keyring). Callers must surface this as its own outcome, never as a prompt.
const LOCKED = /-25308|errSecInteractionNotAllowed|interaction is not allowed|locked collection/i
const UNLOCKED_REUSE_MS = 30_000
// The stderr fallback notice is once per PROCESS: a command (or a host) may build several stores. The flag lives
// in the printing notice so a quiet store (a host under a TUI) can never use up the person's one notice.
let fallbackNoticed = false
const stderrNoticeOncePerProcess = (message: string): void => {
  if (fallbackNoticed) return
  fallbackNoticed = true
  process.stderr.write(`${message}\n`)
}
export const quietNotice = (_message: string): void => {}
const isLocked = (error: unknown): boolean =>
  error instanceof Error && (LOCKED.test(error.message) || LOCKED.test(String((error as { code?: unknown }).code ?? "")))

export function credentialId(api: string): string {
  return createHash("sha256").update(serviceOrigin(api)).digest("hex")
}

export function createCredentialStore(
  api: string,
  options: {
    readonly secrets?: SecretApi | null
    readonly platform?: NodeJS.Platform
    readonly lockProbe?: SecretServiceLockProbe
    readonly notice?: (message: string) => void
    readonly wait?: CredentialReadWait
    readonly home?: string
  } = {},
): CredentialStore {
  const store = createSealedStore(api, "omo-cli", credentialSchema, options.secrets, options.platform, options.lockProbe, options.notice, options.wait,
    (current, value) => {
      const sameIdentity = current !== null && current.device.id === value.device.id
        && current.signingPrivateKey === value.signingPrivateKey
        && current.sealingPrivateKey === value.sealingPrivateKey
        && (value.accountId === undefined || current.accountId === undefined || current.accountId === value.accountId)
      const accountId = value.accountId ?? (sameIdentity ? current?.accountId : undefined)
      // An incoming snapshot cannot restore its old generation after A -> B -> A or clear.
      return {
        ...value,
        ...(accountId === undefined ? {} : { accountId }),
        credentialGeneration: sameIdentity ? current?.credentialGeneration ?? randomUUID() : randomUUID(),
      }
    })
  return {
    read: store.read,
    readAuthoritative: store.readAuthoritative,
    write: value => withCredentialLock(api, () => store.write(value), options.home),
    clear: () => withCredentialLock(api, store.clear, options.home),
  }
}

export function createSealedStore<T>(
  api: string,
  namespace: "omo-cli" | "omo-cli-v2" | "omo-cli-revocations-v2",
  schema: z.ZodType<T>,
  secrets: SecretApi | null = typeof Bun === "undefined" ? null : Bun.secrets,
  platform: NodeJS.Platform = process.platform,
  lockProbe: SecretServiceLockProbe = probeSecretServiceLock,
  notice: (message: string) => void = stderrNoticeOncePerProcess,
  wait: CredentialReadWait = SESSION_READ_WAIT,
  amendWrite?: (previous: T | null, next: T) => T,
): SealedStore<T> {
  if (!secrets) throw new SignInError("OmO sign-in needs Bun 1.4 or newer with OS credential storage. No file fallback is available.")
  const platformName =
    platform === "darwin"
      ? "macOS Keychain"
      : platform === "linux"
        ? "Linux Secret Service (libsecret and an unlocked keyring)"
        : platform === "win32"
          ? "Windows Credential Manager"
          : null
  if (platformName === null) throw new SignInError("This platform has no supported OS credential store.")
  const key = { service: namespace, name: credentialId(api) }
  const slot = `${key.service}\n${key.name}`
  const readsOf = (api: SecretApi): Map<string, Promise<string | null>> => {
    const known = processReads.get(api)
    if (known !== undefined) return known
    const created = new Map<string, Promise<string | null>>()
    processReads.set(api, created)
    return created
  }
  const forget = (api: SecretApi) => {
    readsOf(api).delete(slot)
  }
  const sharedRead = (api: SecretApi): Promise<string | null> => {
    const reads = readsOf(api)
    const pending = reads.get(slot)
    if (pending !== undefined) return pending
    const read = Promise.resolve().then(() => api.get(key))
    const done = () => {
      if (reads.get(slot) === read) reads.delete(slot)
    }
    read.then(done, done)
    reads.set(slot, read)
    return read
  }
  const waiting =
    platform === "darwin"
      ? `macOS Keychain is waiting for your approval: answer the "${basename(process.execPath)} wants to access key ${namespace}" dialog ("Always Allow" stops it asking again)`
      : `${platformName} has not answered; it may be waiting for your approval or an unlock in a system dialog`
  const answered = async (api: SecretApi, fresh = false): Promise<string | null> => {
    const read = fresh ? Promise.resolve().then(() => api.get(key)) : sharedRead(api)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (wait.kind === "interactive") {
        timer = setTimeout(() => wait.notice(`omo: ${waiting}.`), wait.noticeAfterMs)
        return await read
      }
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new KeychainApprovalPendingError(`${waiting}, then try again. Credentials are never saved to a file.`)),
          wait.deadlineMs,
        )
      })
      return await Promise.race([read, expired])
    } finally {
      clearTimeout(timer)
    }
  }
  const unavailable = (error: unknown) =>
    isLocked(error)
      ? new KeychainLockedError(`${platformName} is locked. Unlock it, then try again. Credentials are never saved to a file.`)
      : new CredentialStoreError(
          `Cannot access ${platformName}. Unlock or enable the OS credential store and try again. Credentials are never saved to a file.`,
        )
  // libsecret answers a locked collection by asking the keyring to show its unlock prompt, so on Linux the
  // Locked property is read over D-Bus BEFORE any secret call and a locked collection is never touched. When the
  // probe cannot answer (no gdbus binary, no Secret Service name on the bus, a bus that did not reply) the store
  // falls back to asking libsecret directly, exactly as before the probe existed: login must never depend on gdbus.
  // An unlocked answer is reused for a short while: one CLI command probes once, while a long-lived host (the
  // senpi memory session) still notices a keyring that auto-locked later. Trade-off: a keyring that auto-locks
  // inside that window can still reach libsecret, which may then show its unlock prompt once.
  let unlockedUntil = 0
  let noticed = false
  const assertUsable = async () => {
    if (platform !== "linux" || Date.now() < unlockedUntil) return
    const lock = await lockProbe()
    if (lock === "locked") throw new KeychainLockedError(`${platformName} is locked. Unlock it, then try again. Credentials are never saved to a file.`)
    if (lock === "unlocked") {
      unlockedUntil = Date.now() + UNLOCKED_REUSE_MS
      return
    }
    if (!noticed) {
      noticed = true
      notice("omo: could not check whether the keyring is locked (gdbus or the Secret Service did not answer); using libsecret directly.")
    }
  }
  const parsedRead = async (fresh: boolean): Promise<T | null> => {
    await assertUsable()
    let value: string | null
    try {
      value = await answered(secrets, fresh)
    } catch (error) {
      if (error instanceof KeychainApprovalPendingError) throw error
      throw unavailable(error)
    }
    if (value === null) return null
    try {
      return schema.parse(JSON.parse(value))
    } catch {
      throw new InvalidCredentialState(signInRoute() === "cli"
        ? "Stored sign-in data is invalid. Run omo account forget, then omo login."
        : "The OmO sign-in saved on this computer can't be read. Run omo account forget to remove it, then sign in again in the desktop app.")
    }
  }
  return {
    read: () => parsedRead(false),
    readAuthoritative: () => parsedRead(true),
    async write(value) {
      // One OS-store replacement commits the rotating token and its access token together.
      await assertUsable()
      try {
        let next = value
        if (amendWrite !== undefined) {
          // A parked/coalesced read may predate another process's write. Never use it to
          // assign a generation, and never let it block an otherwise usable writer.
          const raw = await answered(secrets, true)
          let previous: T | null = null
          if (raw !== null) {
            try { previous = schema.parse(JSON.parse(raw)) } catch { /* replacement repairs an invalid item */ }
          }
          next = amendWrite(previous, value)
        }
        await secrets.set({ ...key, value: JSON.stringify(schema.parse(next)) })
      } catch (error) {
        throw unavailable(error)
      }
      forget(secrets)
    },
    async clear() {
      await assertUsable()
      try {
        await secrets.delete(key)
      } catch (error) {
        throw unavailable(error)
      }
      forget(secrets)
    },
  }
}
