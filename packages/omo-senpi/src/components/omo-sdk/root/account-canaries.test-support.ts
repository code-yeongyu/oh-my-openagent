import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { custodyLog, custodyLogPath } from "@oh-my-opencode/account-core/calls/custody-log"
import { accountSignIn } from "@oh-my-opencode/account-core/calls/sign-in"
import { storeSwitchPort } from "@oh-my-opencode/account-core/calls/store"
import type { HelperAccess } from "@oh-my-opencode/account-core/keychain-helper/access"
import { dedicatedFake } from "@oh-my-opencode/account-core/keychain-helper/dedicated-fake.test-support"
import {
  type CredentialStore,
  credentialId,
  InvalidCredentialState,
  KeychainLockedError,
  SecretServiceUnavailableError,
} from "@oh-my-opencode/account-core/keystore"
import { createSession } from "@oh-my-opencode/account-core/session"
import {
  clock,
  fakeApi,
  memorySecrets,
  minted,
  refusal,
  temporaryHome,
} from "@oh-my-opencode/account-core/test-support"
import { assembleOmoSdk } from "../assembly"
import type { OmoPrincipal } from "../contract"

// Security design section 6 for the account calls of slice A1b: a root over the real account core, a fake account
// service and fake stores whose every secret is a recognizable canary, under any principal and one injected fault of
// each class the account calls meet (the service's refusals and errors, the store's, the keychain helper's).

export const CANARIES = {
  accessToken: "a1b-canary-access-5e1f",
  refreshToken: "a1b-canary-refresh-77c2",
  offlineGrant: "a1b-canary-offline-03ab",
  signingPrivateKey: "a1b-canary-signing-9d41",
  sealingPrivateKey: "a1b-canary-sealing-c6e0",
  deviceCode: `dc.a1bcanary${"z".repeat(34)}`,
  keychainValue: "a1b-canary-keychain-value-28f5",
} as const
export const USER_CODE = minted.userCode

const grant = (deviceId: string) => ({
  accessToken: CANARIES.accessToken,
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: CANARIES.refreshToken,
  offlineGrant: CANARIES.offlineGrant,
  device: { id: deviceId, name: "Canary CLI" },
})

export const FAULTS = [
  "none",
  "unauthorized",
  "denied",
  "service_error_body",
  "revoke_unconfirmed",
  "store_locked",
  "store_unavailable",
  "store_unreadable",
  "helper_refuses",
] as const
export type Fault = (typeof FAULTS)[number]

const errorBody = () =>
  Response.json({ error: { code: "server_error", message: `upstream said ${CANARIES.accessToken}` } }, { status: 500 })

function service(fault: Fault): string {
  return fakeApi(async (request) => {
    const path = new URL(request.url).pathname
    if (path === "/v1/health") return Response.json({ ok: true })
    if (fault === "service_error_body") return errorBody()
    if (path === "/v1/device/code") return Response.json({ ...minted, deviceCode: CANARIES.deviceCode })
    if (path === "/v1/device/token")
      return fault === "denied" ? refusal("access_denied") : Response.json(grant("new-device"))
    if (path === "/v1/me")
      return fault === "unauthorized"
        ? refusal("invalid_token", undefined, 401)
        : Response.json({ user: { email: "canary@example.com" }, account: { id: "acct-1" } })
    if (path === "/v1/session/refresh") return Response.json(grant("canary-device"))
    if (request.method === "DELETE")
      return fault === "revoke_unconfirmed" ? errorBody() : new Response(null, { status: 204 })
    return new Response("", { status: 404 })
  })
}

// A store fault carries a canary in its error's own words: the root must answer in its own words, never these.
function faulty(store: CredentialStore, fault: Fault): CredentialStore {
  const thrown =
    fault === "store_locked"
      ? () => new KeychainLockedError(`locked over ${CANARIES.keychainValue}`)
      : fault === "store_unavailable"
        ? () => new SecretServiceUnavailableError(`no keychain for ${CANARIES.refreshToken}`)
        : fault === "store_unreadable"
          ? () => new InvalidCredentialState(`cannot parse ${CANARIES.offlineGrant}`)
          : undefined
  if (thrown === undefined) return store
  return {
    ...store,
    read: async () => {
      throw thrown()
    },
  }
}

const helperRefusing = (
  access: Extract<HelperAccess, { kind: "ready" }>,
): Extract<HelperAccess, { kind: "ready" }> => ({
  ...access,
  call: async (request, lease) =>
    request.verb.startsWith("store-")
      ? { error: "store-refused", reason: `refused ${CANARIES.keychainValue}` }
      : access.call(request, lease),
})

/** A root over the account core with canaries everywhere a secret lives; `logs` collects every log line. */
export async function canaryRoot(fault: Fault = "none", principal: OmoPrincipal = { kind: "person", uid: 501 }) {
  const api = service(fault)
  const home = await temporaryHome()
  mkdirSync(join(home, "memory"), { recursive: true })
  const logs: string[] = []
  const log = (line: string) => logs.push(line)
  const stored = memorySecrets().store(api)
  await stored.write({ ...grant("canary-device"), ...pickKeys() })
  const signedIn = faulty(stored, fault)
  const session = createSession({ api, store: signedIn, home, beforeKeysDiscarded: async () => undefined, log })
  const empty = memorySecrets().store(api)
  const fresh = createSession({ api, store: empty, home, beforeKeysDiscarded: async () => undefined, log })
  const keychain = dedicatedFake()
  keychain.login.put(credentialId(api), CANARIES.keychainValue, "helper")
  const access = fault === "helper_refuses" ? helperRefusing(keychain.access) : keychain.access
  const sdk = assembleOmoSdk(
    {
      principal,
      env: { OMO_SERVICE_API_URL: api, OMO_MEMORY_DIR: join(home, "memory") },
      cwd: home,
      ports: {
        desktopLaunch: () => false,
        custody: custodyLog({ home, principal: { kind: principal.kind, id: principalId(principal) } }),
        credentialStore: signedIn,
        session,
        accountSession: { session, store: signedIn, deviceService: { forget: async () => undefined } },
        accountStore: storeSwitchPort({
          api,
          platform: "darwin",
          state: keychain.state,
          access: async () => access,
          home,
        }),
      },
    },
    {
      signIn: (origin, request, custody) =>
        accountSignIn(
          {
            api: origin,
            session: fresh,
            store: empty,
            accountsOpen: true,
            setUpDeviceService: async () => "on",
            custody,
            ...clock(),
          },
          request,
        ),
    },
  )
  const custodyRecords = async () =>
    await Bun.file(custodyLogPath(home))
      .text()
      .catch(() => "")
  return { sdk, logs, custodyRecords }
}

const principalId = (principal: OmoPrincipal): string =>
  principal.kind === "person" || principal.kind === "script"
    ? String(principal.uid)
    : principal.kind === "session"
      ? principal.session_id
      : principal.kind === "connector"
        ? principal.binding
        : "service"

const pickKeys = () => ({
  signingPrivateKey: CANARIES.signingPrivateKey,
  sealingPrivateKey: CANARIES.sealingPrivateKey,
})
