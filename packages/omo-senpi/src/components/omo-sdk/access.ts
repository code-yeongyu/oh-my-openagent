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
} from "@oh-my-opencode/omo-opencode/service-auth"
import { launchCarriedPrivateTable } from "../memory/desktop-sync/launchClassification"
import { DEFAULT_SERVICE_API } from "../memory/device-session/account-source"
import { cliCredentialStore, openCliSession } from "../memory/device-session/cli-session"
import { ok, type OmoResult, refused } from "./result"

export type SessionPort = Pick<Session, "accessToken" | "request">
export type CredentialStorePort = Pick<CredentialStore, "read">
type Env = Readonly<Record<string, string | undefined>>

export type AccessPorts = {
  readonly session?: SessionPort
  readonly credentialStore?: CredentialStorePort
  /** Whether this engine was launched by the desktop app, which signs in on its own and never shares this store. */
  readonly desktopLaunch?: () => boolean
}

export type SignedIn = {
  readonly device: { readonly id: string; readonly name: string }
  readonly session: SessionPort
}

export type AccountAccess = {
  readonly origin: string
  readonly signedIn: <T>(read: (signedIn: SignedIn) => Promise<T>) => Promise<OmoResult<T>>
  readonly close: () => void
}

export const resolveOrigin = (api: string | undefined, env: Env): string =>
  serviceOrigin(api ?? env["OMO_SERVICE_API_URL"] ?? DEFAULT_SERVICE_API)

const SIGN_IN = "sign this device in to OmO, then retry"

// Every message here is the SDK's own text: a service or store message can carry a credential, so none is passed on.
export function failure<T>(error: unknown): OmoResult<T> {
  if (error instanceof KeychainLockedError)
    return refused("credential_store_locked", "the credential store is locked", "unlock the keychain, then retry")
  if (error instanceof SecretServiceUnavailableError || error instanceof CredentialStoreError)
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
  if (error instanceof ApiRefusal)
    return error.status === 401
      ? refused("session_ended", "the account refused this device's sign-in", SIGN_IN, { code: error.code })
      : refused("service_refused", "the account service refused the request", "check the details, then retry", {
          status: error.status,
          code: error.code,
        })
  if (error instanceof RequestFailure)
    return refused("service_unreachable", "the account service could not be reached", "check the connection, then retry")
  if (error instanceof SignInError || (error instanceof Error && error.name === "ZodError"))
    return refused("service_refused", "the account service sent an answer this SDK cannot read", "update omo, then retry", {
      code: "invalid_response",
    })
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
  let session = options.ports.session
  const openStore = (): CredentialStorePort => options.ports.credentialStore ?? openCliStore()
  const openSession = (): SessionPort =>
    (session ??= openCliSession({
      origin,
      store: openCliStore(),
      env: options.env,
      cwd: options.cwd,
      signal: lifetime.signal,
      log: () => undefined,
    }))
  return {
    origin,
    async signedIn(read) {
      if (lifetime.signal.aborted)
        return refused("internal_error", "this SDK instance is closed", "create a new one with createOmoSdk")
      if (desktopLaunch())
        return refused(
          "desktop_sign_in",
          "a desktop launch uses the desktop app's own sign-in",
          "read the account from the desktop app",
        )
      try {
        const credentials = await openStore().read()
        if (credentials === null) return refused("signed_out", "this device is not signed in", SIGN_IN)
        const device = { id: credentials.device.id, name: credentials.device.name }
        return ok(await read({ device, session: openSession() }))
      } catch (error) {
        return failure(error)
      }
    },
    close: () => lifetime.abort(),
  }
}
