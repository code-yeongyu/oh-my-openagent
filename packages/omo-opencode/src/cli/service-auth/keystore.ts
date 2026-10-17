import { createHash } from "node:crypto"
import { credentialSchema, type Credentials, serviceOrigin, SignInError } from "./protocol"

type SecretKey = { readonly service: string; readonly name: string }
export type SecretApi = {
  readonly get: (key: SecretKey) => Promise<string | null>
  readonly set: (key: SecretKey & { readonly value: string }) => Promise<void>
  readonly delete: (key: SecretKey) => Promise<boolean>
}
export type CredentialStore = {
  readonly read: () => Promise<Credentials | null>
  readonly write: (value: Credentials) => Promise<void>
  readonly clear: () => Promise<void>
}

export function credentialId(api: string): string {
  return createHash("sha256").update(serviceOrigin(api)).digest("hex")
}

export function createCredentialStore(
  api: string,
  secrets: SecretApi | null = typeof Bun === "undefined" ? null : Bun.secrets,
  platform: NodeJS.Platform = process.platform,
): CredentialStore {
  if (!secrets) throw new SignInError("OmO sign-in needs Bun 1.4 or newer with OS credential storage. No file fallback is available.")
  const platformName = platform === "darwin" ? "macOS Keychain"
    : platform === "linux" ? "Linux Secret Service (libsecret and an unlocked keyring)"
    : platform === "win32" ? "Windows Credential Manager" : null
  if (platformName === null) throw new SignInError("This platform has no supported OS credential store.")
  const key = { service: "omo-cli", name: credentialId(api) }
  const unavailable = () => new SignInError(`Cannot access ${platformName}. Unlock or enable the OS credential store and try again. Credentials are never saved to a file.`)
  return {
    async read() {
      let value: string | null
      try { value = await secrets.get(key) } catch { throw unavailable() }
      if (value === null) return null
      try { return credentialSchema.parse(JSON.parse(value)) } catch {
        throw new SignInError("Stored sign-in data is invalid. Run omo logout, then omo login.")
      }
    },
    async write(value) {
      // One OS-store replacement commits the rotating token and its access token together.
      try { await secrets.set({ ...key, value: JSON.stringify(credentialSchema.parse(value)) }) } catch { throw unavailable() }
    },
    async clear() {
      try { await secrets.delete(key) } catch { throw unavailable() }
    },
  }
}
