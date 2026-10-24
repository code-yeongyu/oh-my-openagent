import { createHash } from "node:crypto"
import type { z } from "zod"
import { credentialSchema, type Credentials, serviceOrigin, SignInError } from "./protocol"
import { probeSecretServiceLock, type SecretServiceLockProbe } from "./secret-service-lock"

type SecretKey = { readonly service: string; readonly name: string }
export type SecretApi = {
  readonly get: (key: SecretKey) => Promise<string | null>
  readonly set: (key: SecretKey & { readonly value: string }) => Promise<void>
  readonly delete: (key: SecretKey) => Promise<boolean>
}
export type SealedStore<T> = {
  readonly read: () => Promise<T | null>
  readonly write: (value: T) => Promise<void>
  readonly clear: () => Promise<void>
}
export type CredentialStore = SealedStore<Credentials>

export class CredentialStoreError extends SignInError {}
export class KeychainLockedError extends CredentialStoreError {}
export class SecretServiceUnavailableError extends CredentialStoreError {}
export class InvalidCredentialState extends SignInError {}

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
  secrets: SecretApi | null = typeof Bun === "undefined" ? null : Bun.secrets,
  platform: NodeJS.Platform = process.platform,
  lockProbe: SecretServiceLockProbe = probeSecretServiceLock,
  notice: (message: string) => void = stderrNoticeOncePerProcess,
): CredentialStore {
  return createSealedStore(api, "omo-cli", credentialSchema, secrets, platform, lockProbe, notice)
}

export function createSealedStore<T>(
  api: string,
  namespace: "omo-cli" | "omo-cli-v2" | "omo-cli-revocations-v2",
  schema: z.ZodType<T>,
  secrets: SecretApi | null = typeof Bun === "undefined" ? null : Bun.secrets,
  platform: NodeJS.Platform = process.platform,
  lockProbe: SecretServiceLockProbe = probeSecretServiceLock,
  notice: (message: string) => void = stderrNoticeOncePerProcess,
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
  return {
    async read() {
      await assertUsable()
      let value: string | null
      try {
        value = await secrets.get(key)
      } catch (error) {
        throw unavailable(error)
      }
      if (value === null) return null
      try {
        return schema.parse(JSON.parse(value))
      } catch {
        throw new InvalidCredentialState("Stored sign-in data is invalid. Run omo logout, then omo login.")
      }
    },
    async write(value) {
      // One OS-store replacement commits the rotating token and its access token together.
      await assertUsable()
      try {
        await secrets.set({ ...key, value: JSON.stringify(schema.parse(value)) })
      } catch (error) {
        throw unavailable(error)
      }
    },
    async clear() {
      await assertUsable()
      try {
        await secrets.delete(key)
      } catch (error) {
        throw unavailable(error)
      }
    },
  }
}
