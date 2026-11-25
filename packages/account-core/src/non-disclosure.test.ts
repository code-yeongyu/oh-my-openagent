import { describe, expect, test } from "bun:test"

import { loginDevice } from "./device-flow"
import { createSession } from "./session"
import { clock, fakeApi, memorySecrets, minted, refusal, temporaryHome } from "./test-support"

// Security design #14945 section 6, over the account core #14364 moved: a canary planted in the fake store or the fake
// account service reaches no returned value, failure (message, stack, cause) or log line of an operation, on its ok path
// and under one injected fault each. The device code's user code is the one secret with a destination, the person's
// `show` callback (custody matrix 5.0, account.signIn); it may reach that and nothing else. session.accessToken() and
// store.read() are excluded by design: they hand the credential to the core's own callers (the custody calls of A1d).

const CANARIES = {
  accessToken: "canary-access-7f3a91",
  refreshToken: "canary-refresh-2c84d0",
  offlineGrant: "canary-offline-b61e55",
  signingPrivateKey: "canary-signing-0d9c27",
  sealingPrivateKey: "canary-sealing-e4a813",
  deviceCode: `dc.canary${"q".repeat(37)}`,
} as const
const USER_CODE = minted.userCode
const canaryGrant = {
  accessToken: CANARIES.accessToken,
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: CANARIES.refreshToken,
  offlineGrant: CANARIES.offlineGrant,
  device: { id: "device-canary", name: "Canary CLI" },
}
const storedCredential = (expiresAt: string) => ({
  ...canaryGrant,
  accessTokenExpiresAt: expiresAt,
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

function leaked(surfaces: readonly unknown[], secrets: Readonly<Record<string, string>> = CANARIES): string[] {
  const text = surfaces.map((surface) => surfaceText(surface)).join("\n")
  return Object.entries(secrets)
    .filter(([, canary]) => text.includes(canary))
    .map(([name]) => name)
}

const outcome = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    return await run()
  } catch (error) {
    return error
  }
}

async function signedIn(api: string, expiresAt: string, logs: string[]) {
  const secrets = memorySecrets()
  const store = secrets.store(api)
  const home = await temporaryHome()
  await store.write(storedCredential(expiresAt))
  const session = createSession({ api, store, home, beforeKeysDiscarded: async () => {}, log: (line) => logs.push(line) })
  return { session, store }
}

describe("the account core discloses no planted secret (#14945 section 6, #14364)", () => {
  test("#given a device-code sign-in that succeeds #then the codes reach only the show callback", async () => {
    const api = fakeApi(async (request) =>
      request.url.endsWith("/code") ? Response.json({ ...minted, deviceCode: CANARIES.deviceCode }) : Response.json(canaryGrant),
    )
    const logs: string[] = []
    const shown: unknown[] = []
    const home = await temporaryHome()
    const session = createSession({ api, store: memorySecrets().store(api), home, beforeKeysDiscarded: async () => {}, log: (line) => logs.push(line) })
    const result = await loginDevice(session, {
      name: "Canary CLI",
      platform: "linux",
      ...clock(),
      show: (code) => shown.push(code),
      chooseDevice: async () => null,
    })
    expect(leaked([result, logs])).toEqual([])
    expect(leaked([result, logs], { userCode: USER_CODE })).toEqual([])
    expect(leaked([shown])).toEqual([])
    expect(leaked([shown], { userCode: USER_CODE })).toEqual(["userCode"])
  })

  test("#given a sign-out that succeeds #then its answer and log hold no stored secret", async () => {
    const api = fakeApi(() => Response.json({}))
    const logs: string[] = []
    const { session } = await signedIn(api, "2099-01-01T00:00:00.000Z", logs)
    expect(leaked([await session.logout(), logs])).toEqual([])
  })

  test.each([
    ["a refresh the service refuses with 401", "refused"],
    ["a refresh whose service is unreachable", "unreachable"],
    ["a session whose caller cancelled", "cancelled"],
  ] as const)("#given %s #then the failure holds no stored secret", async (_name, fault) => {
    const api =
      fault === "unreachable" ? "http://127.0.0.1:9" : fakeApi(() => refusal("invalid_grant", undefined, 401))
    const logs: string[] = []
    const { store } = await signedIn(api, "2000-01-01T00:00:00.000Z", logs)
    const controller = new AbortController()
    if (fault === "cancelled") controller.abort(new Error("cancelled by the caller"))
    const home = await temporaryHome()
    const session = createSession({ api, store, home, signal: controller.signal, beforeKeysDiscarded: async () => {}, log: (line) => logs.push(line) })
    const failure = await outcome(() => session.accessToken())
    expect(failure).toBeInstanceOf(Error)
    expect(leaked([failure, logs])).toEqual([])
  })

  test("#given a store backend whose error text carries a secret #then the store's failure does not repeat it", async () => {
    const api = fakeApi(() => Response.json({}))
    const secrets = memorySecrets()
    const store = secrets.store(api)
    await store.write(storedCredential("2099-01-01T00:00:00.000Z"))
    secrets.api.get = async () => {
      throw new Error(`backend reply ${CANARIES.refreshToken}`)
    }
    const failure = await outcome(() => store.read())
    expect(failure).toBeInstanceOf(Error)
    expect(leaked([failure])).toEqual([])
  })

  test("#given an operation that does leak (negative control) #then the scan names the secret it carried", async () => {
    const failure = await outcome(async () => {
      throw new Error("refresh failed", { cause: { body: { refresh_token: CANARIES.refreshToken } } })
    })
    expect(leaked([failure])).toEqual(["refreshToken"])
    expect(leaked([{ nested: [{ value: `Bearer ${CANARIES.accessToken}` }] }])).toEqual(["accessToken"])
  })
})
