import {
  ApiRefusal,
  type CredentialStore,
  CredentialStoreError,
  KeychainLockedError,
  RecoveryExhausted,
  RecoveryPending,
  RequestFailure,
  SecretServiceUnavailableError,
  type Session,
  SessionEnded,
  SignInError,
  serviceOrigin,
} from "@oh-my-opencode/account-core"
import type { DeviceServiceHandoff } from "@oh-my-opencode/account-core/session"
import { launchCarriedPrivateTable } from "../memory/desktop-sync/launchClassification"
import { DEFAULT_SERVICE_API } from "../memory/device-session/account-source"
import { cliCredentialStore, cliSessionDeviceService, openCliSession } from "../memory/device-session/cli-session"
import { ok, type OmoResult, refused } from "./result"

export type SessionPort = Pick<Session, "accessToken" | "request">
/** What account.signOut and account.forget change: this device's session and its credential store. */
export type AccountSessionPort = {
  readonly session: Pick<Session, "logout" | "forget" | "update" | "discard">
  readonly store: Pick<CredentialStore, "clear">
  readonly deviceService?: Pick<DeviceServiceHandoff, "forget">
}
export type CredentialStorePort = Pick<CredentialStore, "read"> & Partial<Pick<CredentialStore, "storage">>
type Env = Readonly<Record<string, string | undefined>>

export type AccessPorts = {
  readonly session?: SessionPort
  readonly credentialStore?: CredentialStorePort
  /** The session and store account.signOut and account.forget act on; absent, this device's CLI session. */
  readonly accountSession?: AccountSessionPort
  /** Whether this engine was launched by the desktop app, which signs in on its own and never shares this store. */
  readonly desktopLaunch?: () => boolean
}

export type SignedIn = {
  readonly device: { readonly id: string; readonly name: string }
  readonly session: SessionPort
}

export type AccountAccess = {
  readonly origin: string
  /** Why no account call may run here at all (a closed SDK, a desktop launch); undefined when one may. */
  readonly blockedReason: () => OmoResult<never> | undefined
  readonly signedIn: <T>(read: (signedIn: SignedIn) => Promise<T>) => Promise<OmoResult<T>>
  /** This device's credential store, the one every account call of this root reads. */
  readonly store: () => CredentialStorePort
  readonly session: () => SessionPort
  readonly account: () => AccountSessionPort
  readonly close: () => void
}

const resolveOrigin = (api: string | undefined, env: Env): string =>
  serviceOrigin(api ?? env["OMO_SERVICE_API_URL"] ?? DEFAULT_SERVICE_API)

export const SIGN_IN = "sign this device in to OmO, then retry"

// Every message here is the SDK's own text: a service or store message can carry a credential, so none is passed on.
export function failure<T>(error: unknown): OmoResult<T> {
  if (error instanceof KeychainLockedError)
    return refused("credential_store_locked", "the credential store is locked", "unlock the keychain, then retry")
  // The native keychain itself unavailable is its own outcome (omo account exits 8, not 9), so it keeps its reason.
  if (error instanceof SecretServiceUnavailableError)
    return refused(
      "credential_store_unavailable",
      "the system keychain is unavailable",
      "make the system keychain available to this process, then retry",
      { reason: "keychain_unavailable" },
    )
  if (error instanceof CredentialStoreError)
    return refused(
      "credential_store_unavailable",
      "the credential store could not be read",
      "make the system keychain available to this process, then retry",
    )
  if (error instanceof SessionEnded || error instanceof RecoveryExhausted)
    return refused("session_ended", "the account ended this device's sign-in", SIGN_IN, { code: error.code })
  if (error instanceof RecoveryPending)
    return refused("service_unreachable", "a sign-in refresh is still being confirmed", "retry in a minute", {
      deadline: new Date(error.deadline).toISOString(),
    })
  if (error instanceof ApiRefusal && error.status === 404 && error.code === "not_found")
    return refused("not_found", "the account has no such device", "list the devices, then use one of their ids")
  if (error instanceof ApiRefusal)
    return error.status === 401
      ? refused("session_ended", "the account refused this device's sign-in", SIGN_IN, { code: error.code })
      : refused("service_refused", "the account service refused the request", "check the details, then retry", {
          status: error.status,
          code: error.code,
        })
  if (error instanceof RequestFailure)
    return refused(
      "service_unreachable",
      "the account service could not be reached",
      "check the connection, then retry",
    )
  if (error instanceof SignInError || (error instanceof Error && error.name === "ZodError"))
    return refused(
      "service_refused",
      "the account service sent an answer this SDK cannot read",
      "update omo, then retry",
      {
        code: "invalid_response",
      },
    )
  return refused("internal_error", "the omo SDK failed unexpectedly", "retry; report it if it repeats", {
    name: error instanceof Error ? error.name : typeof error,
  })
}

export function createAccountAccess(options: {
  readonly api?: string
  readonly env: Env
  readonly cwd: string
  readonly ports: AccessPorts
}): AccountAccess {
  const origin = resolveOrigin(options.api, options.env)
  const lifetime = new AbortController()
  const desktopLaunch = options.ports.desktopLaunch ?? launchCarriedPrivateTable
  let cliStore: CredentialStore | undefined
  const openCliStore = (): CredentialStore => (cliStore ??= cliCredentialStore(origin))
  let cliSession: Session | undefined
  const openCli = (): Session =>
    (cliSession ??= openCliSession({
      origin,
      store: openCliStore(),
      env: options.env,
      cwd: options.cwd,
      signal: lifetime.signal,
      log: () => undefined,
    }))
  const openStore = (): CredentialStorePort => options.ports.credentialStore ?? openCliStore()
  const openSession = (): SessionPort => options.ports.session ?? openCli()
  const openAccount = (): AccountSessionPort =>
    options.ports.accountSession ?? {
      session: openCli(),
      store: openCliStore(),
      deviceService: cliSessionDeviceService(() => undefined),
    }
  const blockedReason = (): OmoResult<never> | undefined => {
    if (lifetime.signal.aborted)
      return refused("internal_error", "this SDK instance is closed", "create a new one with createOmoSdk")
    if (desktopLaunch())
      return refused(
        "desktop_sign_in",
        "a desktop launch uses the desktop app's own sign-in",
        "read the account from the desktop app",
      )
    return undefined
  }
  return {
    origin,
    blockedReason,
    async signedIn(read) {
      const blocked = blockedReason()
      if (blocked !== undefined) return blocked
      try {
        const credentials = await openStore().read()
        if (credentials === null) return refused("signed_out", "this device is not signed in", SIGN_IN)
        const device = { id: credentials.device.id, name: credentials.device.name }
        return ok(await read({ device, session: openSession() }))
      } catch (error) {
        return failure(error)
      }
    },
    store: openStore,
    session: openSession,
    account: openAccount,
    close: () => lifetime.abort(),
  }
}
