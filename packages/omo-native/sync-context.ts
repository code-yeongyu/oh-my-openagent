import { resolveMemoryRoot } from "../memory-core/src/identity/layout"
import { type AccountHttp, createAccountHttp, createPairingHttp, deviceKeyringFromMaterial, type PairingHttp } from "../memory-core/src/sync/account/index.ts"
import type { DeviceKeyring } from "../memory-core/src/sync/keyring-port"
import type { SyncOperationAuthority } from "../memory-core/src/sync/operation-authority"
import { syncPinDir } from "../memory-core/src/sync/pin-dir"

import { signInHint } from "../omo-opencode/src/cli/service-auth/accounts-gate"
import { type CredentialStore, createCredentialStore, INTERACTIVE_READ_WAIT } from "../omo-opencode/src/cli/service-auth/keystore"
import { ApiRefusal, type Credentials, serviceOrigin, SignInError } from "../omo-opencode/src/cli/service-auth/protocol"
import { createSession } from "../omo-opencode/src/cli/service-auth/session"
import { retireSyncPinOnDiscard } from "../omo-opencode/src/cli/service-auth/sync-pin-retire"

export interface SyncContext {
  readonly account: string
  readonly serviceOrigin?: string
  readonly serviceDeviceId: string
  readonly keyring: DeviceKeyring
  readonly pinDir: string
  readonly chain: AccountHttp
  readonly pairing: PairingHttp
  /**
   * Fences every admitted effect (the pin write above all) against the credential this context was
   * built from: a logout or a different sign-in in another process retires the operation (#12303).
   */
  readonly authority: SyncOperationAuthority
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
  const store = options.store ?? createCredentialStore(api, { wait: INTERACTIVE_READ_WAIT })
  const credentials = await store.read()
  if (credentials === null) throw new SignInError(`Not signed in. ${signInHint("first")}`)
  const pinDir = syncPinDir(resolveMemoryRoot(options.env, options.cwd))
  const session = createSession({
    api, store,
    beforeKeysDiscarded: retireSyncPinOnDiscard({ pinDir: () => pinDir, log: (line) => process.stderr.write(`${line}\n`) }),
  })
  const token = () => session.accessToken()
  const doFetch = options.fetch ?? fetch
  const me = await doFetch(`${api}/v1/me`, { headers: { authorization: `Bearer ${await token()}` } })
  if (!me.ok) {
    const body: unknown = await me.json().catch(() => null)
    const code = isRecord(body) && isRecord(body["error"]) ? body["error"]["code"] : undefined
    throw new ApiRefusal(typeof code === "string" ? code : "unknown", me.status)
  }
  const body: unknown = await me.json()
  const account = isRecord(body) && isRecord(body["account"]) ? body["account"]["id"] : undefined
  if (typeof account !== "string" || account === "") throw new SignInError("The service named no account for this sign-in.")
  // Every credential that can earn a sync pin names its account, so discarding its keys can retire the pin (#12280).
  await session.update(async (current) => {
    if (current !== null && current.device.id === credentials.device.id && current.accountId === undefined) await store.write({ ...current, accountId: account })
  })
  const http = { baseUrl: api, token, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) }
  const retired = new AbortController()
  const captured = (current: Credentials | null) =>
    current !== null && current.device.id === credentials.device.id && current.signingPrivateKey === credentials.signingPrivateKey
  const authority: SyncOperationAuthority = {
    signal: retired.signal,
    admit: (dispatch) => {
      retired.signal.throwIfAborted()
      return dispatch()
    },
    boundary: async (dispatch) => (await session.update(async (current) => {
      if (!captured(current)) retired.abort(new Error("The signed-in device is no longer current."))
      retired.signal.throwIfAborted()
      // Box the value: the lock is released after the synchronous dispatch, not an in-flight request.
      return { value: dispatch() }
    })).value,
  }
  return {
    account,
    serviceOrigin: api,
    serviceDeviceId: credentials.device.id,
    keyring: await deviceKeyringFromMaterial({ signingPrivatePkcs8: base64url(credentials.signingPrivateKey), sealingPrivatePkcs8: base64url(credentials.sealingPrivateKey) }),
    pinDir,
    chain: createAccountHttp(http),
    pairing: createPairingHttp(http),
    authority,
  }
}
