import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { accountSignIn } from "@oh-my-opencode/account-core/calls/sign-in"
import { storeSwitchPort } from "@oh-my-opencode/account-core/calls/store"
import { dedicatedFake } from "@oh-my-opencode/account-core/keychain-helper/dedicated-fake.test-support"
import { credentialId } from "@oh-my-opencode/account-core/keystore"
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

// Security design section 6 for the account calls of slice A1b: a root over the real account core, a fake account
// service and fake stores whose every secret is a recognizable canary.

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

export type Fault = "none" | "unauthorized" | "denied"

function service(fault: Fault): string {
  return fakeApi(async (request) => {
    const path = new URL(request.url).pathname
    if (path === "/v1/health") return Response.json({ ok: true })
    if (path === "/v1/device/code") return Response.json({ ...minted, deviceCode: CANARIES.deviceCode })
    if (path === "/v1/device/token")
      return fault === "denied" ? refusal("access_denied") : Response.json(grant("new-device"))
    if (path === "/v1/me")
      return fault === "unauthorized"
        ? refusal("invalid_token", undefined, 401)
        : Response.json({ user: { email: "canary@example.com" }, account: { id: "acct-1" } })
    if (path === "/v1/session/refresh") return Response.json(grant("canary-device"))
    if (request.method === "DELETE") return new Response(null, { status: 204 })
    return new Response("", { status: 404 })
  })
}

/** A person's root over the account core with canaries everywhere a secret lives; `logs` collects every log line. */
export async function canaryRoot(fault: Fault = "none") {
  const api = service(fault)
  const home = await temporaryHome()
  mkdirSync(join(home, "memory"), { recursive: true })
  const logs: string[] = []
  const log = (line: string) => logs.push(line)
  const signedIn = memorySecrets().store(api)
  await signedIn.write({ ...grant("canary-device"), ...pickKeys() })
  const session = createSession({ api, store: signedIn, home, beforeKeysDiscarded: async () => undefined, log })
  const empty = memorySecrets().store(api)
  const fresh = createSession({ api, store: empty, home, beforeKeysDiscarded: async () => undefined, log })
  const keychain = dedicatedFake()
  keychain.login.put(credentialId(api), CANARIES.keychainValue, "helper")
  const sdk = assembleOmoSdk(
    {
      principal: { kind: "person", uid: 501 },
      env: { OMO_SERVICE_API_URL: api, OMO_MEMORY_DIR: join(home, "memory") },
      cwd: home,
      ports: {
        desktopLaunch: () => false,
        credentialStore: signedIn,
        session,
        accountSession: { session, store: signedIn, deviceService: { forget: async () => undefined } },
        accountStore: storeSwitchPort({
          api,
          platform: "darwin",
          state: keychain.state,
          access: async () => keychain.access,
          home,
        }),
      },
    },
    {
      signIn: (origin, request) =>
        accountSignIn(
          {
            api: origin,
            session: fresh,
            store: empty,
            accountsOpen: true,
            setUpDeviceService: async () => "on",
            ...clock(),
          },
          request,
        ),
    },
  )
  return { sdk, logs }
}

const pickKeys = () => ({
  signingPrivateKey: CANARIES.signingPrivateKey,
  sealingPrivateKey: CANARIES.sealingPrivateKey,
})

function surfaceText(value: unknown, seen = new Set<unknown>()): string {
  if (value === null || typeof value !== "object") return String(value)
  if (seen.has(value)) return ""
  seen.add(value)
  const own = Object.getOwnPropertyNames(value).map((key) => `${key}=${surfaceText(Reflect.get(value, key), seen)}`)
  return value instanceof Error ? [value.message, value.stack ?? "", ...own].join("\n") : own.join("\n")
}

/** The names of the canaries any of `surfaces` holds, read through every own property, message and stack. */
export function leaked(surfaces: readonly unknown[], secrets: Readonly<Record<string, string>> = CANARIES): string[] {
  const text = surfaces.map((surface) => surfaceText(surface)).join("\n")
  return Object.entries(secrets)
    .filter(([, canary]) => text.includes(canary))
    .map(([name]) => name)
}
