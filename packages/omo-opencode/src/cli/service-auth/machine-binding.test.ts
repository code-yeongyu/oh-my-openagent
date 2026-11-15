import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, type KeyObject, verify } from "node:crypto"
import { existsSync } from "node:fs"
import type { CredentialStore } from "./keystore"
import { machineBindingAfterRefresh, machineBindingMarkerPath, machineBindSigningBytes } from "./machine-binding"
import type { Credentials } from "./protocol"
import { createSession } from "./session"
import { fakeApi, grant, refusal, temporaryHome } from "./test-support"

// #6503 FINAL contract section 4: a desktop or CLI device registered before machine identity binds its own live row to
// this machine (`PUT /v1/devices/current/machine`), so the service can refuse a second device for the same computer and
// fold the duplicates it already has. The CLI's refresh path is the one place every signed-in machine passes through
// (the desktop app reads its token through `omo account token`), so a held legacy device binds after a refresh.

const DIGEST = "5f".repeat(32)
const NOW = Date.parse("2030-01-01T00:00:00Z")
const NOW_SECONDS = NOW / 1000
const DAY = 24 * 60 * 60 * 1000

function deviceKey(): { readonly der: string; readonly publicKey: KeyObject } {
  const pair = generateKeyPairSync("ed25519")
  return { der: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), publicKey: pair.publicKey }
}

/** A promise and the function that settles it, so a test can hold a service answer and observe a request arrive. */
function signal<T = void>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** The value, or a failure once a bound that no correct run gets near has passed. */
async function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not settle in 4 s`)), 4_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

type BindRequest = {
  readonly machineDigest: string
  readonly issuedAt: number
  readonly signature: string
  readonly authorization: string | null
}

function service(
  options: {
    readonly capability?: boolean
    /** Every refresh answers with an already expired token, so each token read refreshes again. */
    readonly expiringTokens?: boolean
    readonly bind?: (request: BindRequest, count: number) => Response
    /** Holds every /v1/health answer until this settles. */
    readonly healthHeld?: Promise<void>
  } = {},
) {
  const binds: BindRequest[] = []
  const calls: string[] = []
  const healthAsked = signal()
  let refreshes = 0
  const api = fakeApi(async (request) => {
    const path = new URL(request.url).pathname
    calls.push(`${request.method} ${path}`)
    if (path === "/v1/session/refresh") {
      refreshes += 1
      return Response.json({
        accessToken: `at-${refreshes}`,
        accessTokenExpiresAt: options.expiringTokens === true ? "2000-01-01T00:00:00.000Z" : "2030-01-01T01:00:00.000Z",
        refreshToken: `rt-${refreshes}`,
      })
    }
    if (path === "/v1/health") {
      healthAsked.resolve()
      await options.healthHeld
      return Response.json({
        status: "ok",
        ...(options.capability === false ? {} : { capabilities: { machineIdentity: "hardware-digest-v1" } }),
      })
    }
    if (path === "/v1/me") return Response.json({ account: { id: "acct_from_me" }, user: {} })
    if (path === "/v1/devices/current/machine" && request.method === "PUT") {
      const body = (await request.json()) as Omit<BindRequest, "authorization">
      const bind = { ...body, authorization: request.headers.get("authorization") }
      binds.push(bind)
      return options.bind?.(bind, binds.length) ?? Response.json({ deviceId: grant.device.id })
    }
    return refusal("not_found", undefined, 404)
  })
  return {
    api,
    binds,
    calls,
    healthAsked: healthAsked.promise,
    count: (call: string) => calls.filter((c) => c === call).length,
  }
}

function memoryStore(initial: Credentials) {
  let value: Credentials | null = initial
  const store: CredentialStore = {
    read: async () => value,
    readAuthoritative: async () => value,
    write: async (next) => {
      value = next
    },
    clear: async () => {
      value = null
    },
  }
  return { store, current: () => value }
}

async function machine(
  api: string,
  options: {
    readonly accountId?: string
    readonly digest?: string | undefined
    readonly readDigest?: () => Promise<string | undefined>
    readonly signingPrivateKey?: string
    readonly withBinding?: boolean
    readonly budgetMs?: number
  } = {},
) {
  const home = await temporaryHome()
  const key = deviceKey()
  const initial: Credentials = {
    ...grant,
    accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
    signingPrivateKey: options.signingPrivateKey ?? key.der,
    sealingPrivateKey: "synthetic-sealing-private",
    ...(options.accountId === undefined ? {} : { accountId: options.accountId }),
  }
  const { store, current } = memoryStore(initial)
  const logs: string[] = []
  const digest = "digest" in options ? options.digest : DIGEST
  let now = NOW
  const binding = machineBindingAfterRefresh({
    api,
    home,
    readDigest: options.readDigest ?? (async () => digest),
    now: () => now,
    log: (line) => logs.push(line),
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
  })
  const session = createSession({
    api,
    store,
    home,
    now: () => now,
    beforeKeysDiscarded: async () => undefined,
    ...(options.withBinding === false ? {} : { machineBinding: binding }),
  })
  return {
    session,
    key,
    initial,
    current,
    logs,
    markerPath: machineBindingMarkerPath(home, api),
    /** A token read, then the binding it started, settled. */
    read: async () => {
      const token = await session.accessToken()
      await within(binding.settled(), "the binding")
      return token
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}

const signedBy = (publicKey: KeyObject, signature: string, fields: Parameters<typeof machineBindSigningBytes>[0]) =>
  verify(null, machineBindSigningBytes(fields), publicKey, Buffer.from(signature, "base64url"))

describe("the held-device machine binding signs the contract's exact bytes", () => {
  test("the six fields are UTF-8 joined by newlines in contract order", () => {
    const bytes = machineBindSigningBytes({
      origin: "https://api.omo.dev",
      accountId: "acct_1",
      deviceId: "dev_1",
      machineDigest: DIGEST,
      issuedAt: 1_900_000_000,
    })
    expect(new TextDecoder().decode(bytes)).toBe(
      `omo-machine-bind-v1\nhttps://api.omo.dev\nacct_1\ndev_1\n${DIGEST}\n1900000000`,
    )
  })
})

describe("a refreshed legacy device binds itself to this machine", () => {
  test("it PUTs this machine's digest signed by the device's own key with the fresh token, once per device", async () => {
    const s = service({ expiringTokens: true })
    const m = await machine(s.api, { accountId: "acct_42" })

    expect(await m.read()).toBe("at-1")
    expect(s.binds).toHaveLength(1)
    const [bind] = s.binds
    expect(bind?.machineDigest).toBe(DIGEST)
    expect(bind?.issuedAt).toBe(NOW_SECONDS)
    expect(bind?.authorization).toBe("Bearer at-1")
    expect(
      signedBy(m.key.publicKey, bind?.signature ?? "", {
        origin: s.api,
        accountId: "acct_42",
        deviceId: grant.device.id,
        machineDigest: DIGEST,
        issuedAt: NOW_SECONDS,
      }),
    ).toBe(true)
    expect(existsSync(m.markerPath)).toBe(true)

    // The next refresh finds the device bound and asks the service nothing more about it, not even a day later.
    m.advance(DAY)
    expect(await m.read()).toBe("at-2")
    expect(s.binds).toHaveLength(1)
    expect(s.count("GET /v1/health")).toBe(1)
    expect(m.current()?.device.id).toBe(grant.device.id)
    expect(m.current()?.signingPrivateKey).toBe(m.initial.signingPrivateKey)
  })

  test("a credential that never stamped its account signs the account the service names for its token", async () => {
    const s = service()
    const m = await machine(s.api)
    await m.read()
    expect(s.binds).toHaveLength(1)
    expect(
      signedBy(m.key.publicKey, s.binds[0]?.signature ?? "", {
        origin: s.api,
        accountId: "acct_from_me",
        deviceId: grant.device.id,
        machineDigest: DIGEST,
        issuedAt: NOW_SECONDS,
      }),
    ).toBe(true)
  })

  test("the snapshot path (omo account token) binds too", async () => {
    const s = service()
    const m = await machine(s.api, { accountId: "acct_42" })
    expect((await m.session.accessSnapshot())?.accessToken).toBe("at-1")
    await m.read()
    expect(s.binds).toHaveLength(1)
  })

  test("a clock_skew answer is signed again once with the service time", async () => {
    const serverTime = NOW_SECONDS + 900
    const s = service({
      bind: (_request, count) =>
        count === 1
          ? refusal("clock_skew", { reason: "clock_skew", serverTime }, 400)
          : Response.json({ deviceId: grant.device.id }),
    })
    const m = await machine(s.api, { accountId: "acct_42" })
    await m.read()
    expect(s.binds.map((bind) => bind.issuedAt)).toEqual([NOW_SECONDS, serverTime])
    expect(
      signedBy(m.key.publicKey, s.binds[1]?.signature ?? "", {
        origin: s.api,
        accountId: "acct_42",
        deviceId: grant.device.id,
        machineDigest: DIGEST,
        issuedAt: serverTime,
      }),
    ).toBe(true)
    expect(existsSync(m.markerPath)).toBe(true)
  })
})

describe("L1: a binding costs a refresh nothing it does not need and never holds the token", () => {
  test("a machine with no validated hardware id asks the service nothing, never a sentinel", async () => {
    const s = service({ expiringTokens: true })
    const m = await machine(s.api, { accountId: "acct_42", digest: undefined })
    await m.read()
    await m.read()
    expect(s.calls).toEqual(["POST /v1/session/refresh", "POST /v1/session/refresh"])
  })

  test("a service without hardware-digest-v1 is asked again only a day later, not at every refresh", async () => {
    const s = service({ capability: false, expiringTokens: true })
    const m = await machine(s.api, { accountId: "acct_42" })
    await m.read()
    await m.read()
    m.advance(DAY - 1)
    await m.read()
    expect(s.count("GET /v1/health")).toBe(1)
    expect(s.binds).toHaveLength(0)
    expect(m.logs).toEqual([])

    m.advance(1)
    await m.read()
    expect(s.count("GET /v1/health")).toBe(2)
    expect(s.binds).toHaveLength(0)
  })

  test("the token read answers while the binding still waits on the service", async () => {
    const health = signal()
    const s = service({ healthHeld: health.promise })
    const m = await machine(s.api, { accountId: "acct_42" })

    const token = m.session.accessToken()
    await within(s.healthAsked, "the health request")
    expect(await within(token, "the token read")).toBe("at-1")
    expect(s.binds).toHaveLength(0)

    health.resolve()
    await m.read()
    expect(s.binds).toHaveLength(1)
  })

  test("a service that never answers ends the binding at its time limit and keeps the token", async () => {
    const s = service({ healthHeld: new Promise(() => undefined) })
    const m = await machine(s.api, { accountId: "acct_42", budgetMs: 50 })
    expect(await m.read()).toBe("at-1")
    expect(s.binds).toHaveLength(0)
    expect(m.logs).toHaveLength(1)
    expect(existsSync(m.markerPath)).toBe(false)
  })
})

describe("L2: only a definitive answer is final", () => {
  test.each([
    ["a missing route (404)", () => refusal("not_found", undefined, 404)],
    ["an unknown refusal (405)", () => refusal("method_not_allowed", undefined, 405)],
    ["a second clock_skew", () => refusal("clock_skew", { reason: "clock_skew", serverTime: NOW_SECONDS + 900 }, 400)],
    ["machine_exists without a device id", () => refusal("machine_exists", { reason: "machine_exists" }, 409)],
    ["a refused token (401)", () => refusal("unauthorized", undefined, 401)],
  ])("%s is asked again a day later, not at every refresh", async (_name, answer) => {
    const s = service({ expiringTokens: true, bind: answer })
    const m = await machine(s.api, { accountId: "acct_42" })
    expect(await m.read()).toBe("at-1")
    const asked = s.binds.length
    expect(asked).toBeGreaterThan(0)
    expect(m.logs).toHaveLength(1)

    await m.read()
    expect(s.binds).toHaveLength(asked)

    m.advance(DAY)
    await m.read()
    expect(s.binds.length).toBeGreaterThan(asked)
    expect(m.current()?.device.id).toBe(grant.device.id)
  })

  test.each([
    ["device_revoked", () => refusal("device_revoked", undefined, 401)],
    ["invalid_request (bound to another machine)", () => refusal("invalid_request", undefined, 400)],
    ["forbidden", () => refusal("forbidden", undefined, 403)],
  ])("%s is final for this device", async (_name, answer) => {
    const s = service({ expiringTokens: true, bind: answer })
    const m = await machine(s.api, { accountId: "acct_42" })
    await m.read()
    expect(s.binds).toHaveLength(1)
    m.advance(30 * DAY)
    await m.read()
    expect(s.binds).toHaveLength(1)
    expect(m.logs).toHaveLength(1)
  })
})

describe("L3: a binding never changes the sign-in or token result", () => {
  test("a stored signing key that is not PKCS#8 leaves the token read whole and logs one line", async () => {
    const s = service({ expiringTokens: true })
    const m = await machine(s.api, {
      accountId: "acct_42",
      signingPrivateKey: Buffer.from("not a pkcs8 key").toString("base64"),
    })
    expect(await m.read()).toBe("at-1")
    expect(m.logs).toHaveLength(1)
    expect(s.binds).toHaveLength(0)
    // The same stored key fails the same way: it is not tried again at every refresh.
    expect(await m.read()).toBe("at-2")
    expect(m.logs).toHaveLength(1)
  })

  test("a hardware id read that throws leaves the token read whole and logs one line", async () => {
    const s = service()
    const m = await machine(s.api, {
      accountId: "acct_42",
      readDigest: async () => {
        throw new Error("synthetic hardware read failure")
      },
    })
    expect(await m.read()).toBe("at-1")
    expect(m.logs).toHaveLength(1)
    expect(s.binds).toHaveLength(0)
  })
})

describe("a binding never moves, removes or replaces the held identity", () => {
  test("machine_exists names the other device, keeps this sign-in untouched and is not asked again", async () => {
    const s = service({
      expiringTokens: true,
      bind: () => refusal("machine_exists", { reason: "machine_exists", deviceId: "dev_other" }, 409),
    })
    const m = await machine(s.api, { accountId: "acct_42" })

    expect(await m.read()).toBe("at-1")
    expect(m.current()?.device.id).toBe(grant.device.id)
    expect(m.current()?.signingPrivateKey).toBe(m.initial.signingPrivateKey)
    expect(m.logs.some((line) => line.includes("dev_other"))).toBe(true)
    expect(existsSync(m.markerPath)).toBe(true)

    m.advance(30 * DAY)
    await m.read()
    expect(s.binds).toHaveLength(1)
  })

  test("a service that fails the binding keeps the token and tries again at the next refresh", async () => {
    const s = service({ expiringTokens: true, bind: () => refusal("internal", undefined, 500) })
    const m = await machine(s.api, { accountId: "acct_42" })

    expect(await m.read()).toBe("at-1")
    expect(existsSync(m.markerPath)).toBe(false)
    expect(m.logs).toHaveLength(1)
    await m.read()
    expect(s.binds).toHaveLength(2)
  })

  test("a session created without a binding refreshes exactly as before", async () => {
    const s = service()
    const m = await machine(s.api, { accountId: "acct_42", withBinding: false })
    await m.session.accessToken()
    expect(s.calls).toEqual(["POST /v1/session/refresh"])
  })
})
