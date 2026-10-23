// The signed-in device as memory sync sees it: the service origin, the account its sync records
// are bound to, the key pair it registered at sign-in, and a bearer token that refreshes. A host
// supplies one DeviceAccountSource; everything after it is the same code for the TUI, the CLI and
// the desktop. Private keys stay in the credential store and reach only the keyring built from them.

import { type Credentials, createCredentialStore, type CredentialStore, createSession, quietNotice, serviceOrigin, SignInError } from "@oh-my-opencode/omo-opencode/service-auth"

import type { DeviceKeyMaterial, DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"

export type KeyringFactory = (material: DeviceKeyMaterial) => Promise<DeviceKeyring>

export interface DeviceAccount {
  readonly api: string
  readonly accountId: string
  readonly keyring: (build: KeyringFactory) => Promise<DeviceKeyring>
  readonly accessToken: () => Promise<string>
  /** True once the device's credentials are gone (signed out, or the service revoked the device). */
  readonly signedOut: () => Promise<boolean>
}

export type DeviceAccountSource = () => Promise<DeviceAccount | null>

export const DEFAULT_SERVICE_API = "https://api.omo.dev"

const base64url = (base64: string): string => Buffer.from(base64, "base64").toString("base64url")

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

async function accountIdOf(api: string, token: string, doFetch: typeof fetch): Promise<string> {
  const response = await doFetch(`${api}/v1/me`, { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`memory sync: the account read failed (${response.status})`)
  const body: unknown = await response.json()
  const account = isRecord(body) ? body["account"] : undefined
  const id = isRecord(account) ? account["id"] : undefined
  if (typeof id !== "string" || id === "") throw new Error("memory sync: the account read named no account")
  return id
}

export function createCliAccountSource(options: {
  readonly api?: string
  readonly env?: Record<string, string | undefined>
  readonly store?: CredentialStore
  readonly fetch?: typeof fetch
}): DeviceAccountSource {
  const api = serviceOrigin(options.api ?? options.env?.OMO_SERVICE_API_URL ?? DEFAULT_SERVICE_API)
  const doFetch = options.fetch ?? fetch
  return async () => {
    let store: CredentialStore
    let credentials: Credentials | null
    try {
      // A host runs under a TUI: the CLI's keyring-fallback notice must not write over it, and the fallback is
      // the same libsecret path the CLI uses (#10658 review).
      store = options.store ?? createCredentialStore(api, undefined, undefined, undefined, quietNotice)
      credentials = await store.read()
    } catch (error) {
      // A host with no usable OS credential store (plain Node, a locked or absent keyring) cannot be
      // signed in; that is the signed-out state, not a sync failure on every session bind.
      if (error instanceof SignInError) return null
      throw error
    }
    if (credentials === null) return null
    const session = createSession({ api, store })
    const accessToken = () => session.accessToken()
    return {
      api,
      accountId: await accountIdOf(api, await accessToken(), doFetch),
      keyring: (build) => build({ signingPrivatePkcs8: base64url(credentials.signingPrivateKey), sealingPrivatePkcs8: base64url(credentials.sealingPrivateKey) }),
      accessToken,
      signedOut: async () => (await store.read()) === null,
    }
  }
}
