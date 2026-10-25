import { resolveMemoryRoot } from "../memory-core/src/identity/layout"
import { type AccountHttp, createAccountHttp, createPairingHttp, deviceKeyringFromMaterial, type PairingHttp } from "../memory-core/src/sync/account/index.ts"
import type { DeviceKeyring } from "../memory-core/src/sync/keyring-port"
import { syncPinDir } from "../memory-core/src/sync/pin-dir"

import { type CredentialStore, createCredentialStore } from "../omo-opencode/src/cli/service-auth/keystore"
import { serviceOrigin, SignInError } from "../omo-opencode/src/cli/service-auth/protocol"
import { createSession } from "../omo-opencode/src/cli/service-auth/session"

export interface SyncContext {
  readonly account: string
  readonly serviceDeviceId: string
  readonly keyring: DeviceKeyring
  readonly pinDir: string
  readonly chain: AccountHttp
  readonly pairing: PairingHttp
}

export interface SyncContextOptions {
  readonly env: Record<string, string | undefined>
  readonly cwd: string
  readonly store?: CredentialStore
  readonly fetch?: typeof fetch
}

const base64url = (base64: string): string => Buffer.from(base64, "base64").toString("base64url")

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

export async function signedInSyncContext(options: SyncContextOptions): Promise<SyncContext> {
  const api = serviceOrigin(options.env.OMO_SERVICE_API_URL ?? "https://api.omo.dev")
  const store = options.store ?? createCredentialStore(api)
  const credentials = await store.read()
  if (credentials === null) throw new SignInError("Not signed in. Run omo login first.")
  const session = createSession({ api, store })
  const token = () => session.accessToken()
  const doFetch = options.fetch ?? fetch
  const me = await doFetch(`${api}/v1/me`, { headers: { authorization: `Bearer ${await token()}` } })
  if (!me.ok) throw new SignInError(`The account could not be read (${me.status}). Try again, or run omo login.`)
  const body: unknown = await me.json()
  const account = isRecord(body) && isRecord(body["account"]) ? body["account"]["id"] : undefined
  if (typeof account !== "string" || account === "") throw new SignInError("The service named no account for this sign-in.")
  const http = { baseUrl: api, token, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) }
  return {
    account,
    serviceDeviceId: credentials.device.id,
    keyring: await deviceKeyringFromMaterial({ signingPrivatePkcs8: base64url(credentials.signingPrivateKey), sealingPrivatePkcs8: base64url(credentials.sealingPrivateKey) }),
    pinDir: syncPinDir(resolveMemoryRoot(options.env, options.cwd)),
    chain: createAccountHttp(http),
    pairing: createPairingHttp(http),
  }
}
