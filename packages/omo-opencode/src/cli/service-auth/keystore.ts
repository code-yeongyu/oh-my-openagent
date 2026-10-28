import { createHash } from "node:crypto"
import { basename } from "node:path"
import type { z } from "zod"
import { signInRoute } from "./accounts-gate"
import { credentialSchema, type Credentials, serviceOrigin, SignInError } from "./protocol"
import type { HelperLease } from "./keychain-helper/client"
import { asKeystoreError, HelperMissingForOwnedItem, type KeychainHelperOptions } from "./keychain-helper/darwin-backend"
import { HelperOldSlotsFull } from "./keychain-helper/darwin-store"
import { bindKeychainHelper, type LockedStore, lockedStoreView } from "./keychain-helper/store-binding"
import { probeSecretServiceLock, type SecretServiceLockProbe } from "./secret-service-lock"

type SecretKey = { readonly service: string; readonly name: string }
export type SecretApi = {
  readonly get: (key: SecretKey) => Promise<string | null>
  readonly set: (key: SecretKey & { readonly value: string }) => Promise<void>
  readonly delete: (key: SecretKey) => Promise<boolean>
}
export type { LockedStore }
export type SealedStore<T> = {
  readonly read: () => Promise<T | null>
  readonly write: (value: T) => Promise<void>
  readonly clear: () => Promise<void>
  /** Before the session lock: settles any approval, so no access dialog is ever open while the lock is held. */
  readonly prepare?: () => Promise<void>
  /** Null when this store has no helper: the session then uses its own view over the store object it was given. */
  readonly underLock?: (lease: HelperLease) => Promise<LockedStore<T> | null>
}
export type CredentialStore = SealedStore<Credentials>

export class CredentialStoreError extends SignInError {}
export class KeychainLockedError extends CredentialStoreError {}
export class SecretServiceUnavailableError extends CredentialStoreError {}
export class InvalidCredentialState extends SignInError {}
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
    readonly keychainHelper?: KeychainHelperOptions
  } = {},
): CredentialStore {
  return createSealedStore(api, "omo-cli", credentialSchema, options.secrets, options.platform, options.lockProbe, options.notice, options.wait, options.keychainHelper)
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
  keychainHelper?: KeychainHelperOptions,
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
  const helper = bindKeychainHelper({
    platform,
    namespace,
    secrets,
    key,
    background: wait.kind === "bounded",
    notice,
    pending: message => new KeychainApprovalPendingError(message),
    ...(keychainHelper === undefined ? {} : { options: keychainHelper }),
  })
  secrets = helper.secrets
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
  const helperWaiting = `macOS Keychain is waiting for your approval: answer the "OmO's keychain helper wants to access key ${namespace}" dialog`
  const answered = async (api: SecretApi): Promise<string | null> => {
    const waitingFor = helper.isHelperReader(api) ? helperWaiting : waiting
    const read = sharedRead(api)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (wait.kind === "interactive") {
        timer = setTimeout(() => wait.notice(`omo: ${waitingFor}.`), wait.noticeAfterMs)
        return await read
      }
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new KeychainApprovalPendingError(`${waitingFor}, then try again. Credentials are never saved to a file.`)),
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
  const parseStored = (value: string): T => {
    try {
      return schema.parse(JSON.parse(value))
    } catch {
      throw new InvalidCredentialState(signInRoute() === "cli"
        ? "Stored sign-in data is invalid. Run omo logout, then omo login."
        : "The OmO sign-in saved on this computer can't be read, and it can't be reset from the terminal yet.")
    }
  }
  const readText = async (): Promise<string | null> => {
    await assertUsable()
    const backend = await helper.backend()
    try {
      if (backend === null) await helper.guardHelperless()
      return await answered(backend === null ? secrets : helper.reader(backend))
    } catch (error) {
      if (error instanceof KeychainApprovalPendingError) throw error
      if (error instanceof HelperMissingForOwnedItem) throw new CredentialStoreError(error.message)
      throw unavailable(error)
    }
  }
  const lockedFailure = (error: unknown): unknown => {
    const mapped = asKeystoreError(error, message => new KeychainApprovalPendingError(message))
    if (error instanceof HelperOldSlotsFull) return new CredentialStoreError(error.message)
    if (mapped instanceof KeychainApprovalPendingError || mapped instanceof SignInError) return mapped
    if (mapped instanceof Error && mapped.name === "LockLeaseLostError") return mapped
    return unavailable(mapped)
  }
  const store: SealedStore<T> = {
    async prepare() {
      if ((await helper.backend()) !== null) await readText()
    },
    async underLock(lease) {
      const backend = await helper.backend()
      if (backend === null) return null
      const codec = { parse: parseStored, serialize: (value: T) => JSON.stringify(schema.parse(value)) }
      return lockedStoreView(backend, lease, codec, lockedFailure, () => forget(helper.reader(backend)))
    },
    async read() {
      const value = await readText()
      return value === null ? null : parseStored(value)
    },
    async write(value) {
      // One OS-store replacement commits the rotating token and its access token together.
      await assertUsable()
      if ((await helper.backend()) !== null) throw new Error("OmO's keychain helper writes only under the session lock.")
      try {
        await secrets.set({ ...key, value: JSON.stringify(schema.parse(value)) })
      } catch (error) {
        throw unavailable(error)
      }
      forget(secrets)
    },
    async clear() {
      await assertUsable()
      if ((await helper.backend()) !== null) throw new Error("OmO's keychain helper deletes only under the session lock.")
      try {
        await secrets.delete(key)
      } catch (error) {
        throw unavailable(error)
      }
      forget(secrets)
    },
  }
  return store
}
