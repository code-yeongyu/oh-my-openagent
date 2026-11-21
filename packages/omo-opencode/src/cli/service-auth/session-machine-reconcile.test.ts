import { describe, expect, onTestFinished, test } from "bun:test"
import { createPublicKey, verify } from "node:crypto"
import { join } from "node:path"
import type { CredentialStore } from "./keystore"
import { generateDeviceKeys } from "./device-keys"
import { reconcileDevice } from "./machine-reconcile"
import { ApiRefusal, type Credentials } from "./protocol"
import { createSession } from "./session"
import { fakeApi, grant, refusal, temporaryHome } from "./test-support"

// #13651: a device signed in before machine identity binds itself to its machine after a refresh, once, and a
// generated label (`omo CLI on <host>`) becomes the machine name once; a name the person chose is never touched.

const DIGEST = "a".repeat(64)
const keys = generateDeviceKeys()
const expiredTokens = { accessTokenExpiresAt: "2000-01-01T00:00:00Z" }

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

type Service = {
  name: string
  bound: boolean | undefined
  bindAnswer: "bound" | "machine_exists"
  /** Rows of other devices listed before this one; they may be malformed. */
  others?: unknown[]
  /** When set, the device list answers only after this settles. */
  stall?: Promise<void>
  /** Answers `/v1/me`; absent, the route is not found. */
  me?: (request: Request) => Promise<Response>
  /** Runs when a rename reaches the service. */
  onRename?: () => void
}

function service(initial: Service) {
  const state = { ...initial }
  const binds: { body: Record<string, unknown>; verified: boolean }[] = []
  const renames: { path: string; body: unknown }[] = []
  let rotation = 0
  const api = fakeApi(async (request) => {
    const { pathname } = new URL(request.url)
    if (request.method === "POST" && pathname === "/v1/session/refresh") {
      rotation += 1
      // Every reply is already expired, so each accessToken() call refreshes again.
      return Response.json({ ...expiredTokens, accessToken: `access-${rotation}`, refreshToken: `refresh-${rotation}` })
    }
    if (request.method === "GET" && pathname === "/v1/devices") {
      await state.stall
      return Response.json({
        devices: [
          ...(state.others ?? []),
          {
            id: grant.device.id,
            name: state.name,
            current: true,
            revokedAt: null,
            ...(state.bound === undefined ? {} : { machineBound: state.bound }),
          },
          { id: "device-other", name: "other", current: false, revokedAt: null, machineBound: true },
        ],
        browsers: [],
      })
    }
    if (request.method === "PUT" && pathname === "/v1/devices/current/machine") {
      const body = (await request.json()) as Record<string, unknown>
      const signed = [
        "omo-machine-bind-v1",
        api,
        "acct_42",
        grant.device.id,
        String(body["machineDigest"]),
        String(body["issuedAt"]),
      ].join("\n")
      const verified = verify(
        null,
        Buffer.from(signed, "utf8"),
        createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: keys.public.signingKey }, format: "jwk" }),
        Buffer.from(String(body["signature"]), "base64url"),
      )
      binds.push({ body, verified })
      if (state.bindAnswer === "machine_exists") return refusal("machine_exists", { reason: "machine_exists" }, 409)
      state.bound = true
      return Response.json({ deviceId: grant.device.id })
    }
    if (request.method === "GET" && pathname === "/v1/me" && state.me !== undefined) return state.me(request)
    if (request.method === "PATCH" && pathname.startsWith("/v1/devices/")) {
      const body = (await request.json()) as { name: string }
      renames.push({ path: pathname, body })
      state.onRename?.()
      state.name = body.name
      return new Response(null, { status: 204 })
    }
    return refusal("not_found", undefined, 404)
  })
  return { api, state, binds, renames }
}

async function signedIn(
  name: string,
  server: ReturnType<typeof service>,
  budgetMs?: number,
  options: { readonly accountId?: string; readonly store?: (store: CredentialStore) => CredentialStore } = {
    accountId: "acct_42",
  },
) {
  const stored: Credentials = {
    ...grant,
    ...expiredTokens,
    device: { id: grant.device.id, name },
    ...keys.private,
    ...(options.accountId === undefined ? {} : { accountId: options.accountId }),
  }
  const memory = memoryStore(stored)
  const store = options.store?.(memory.store) ?? memory.store
  const lines: string[] = []
  const forgotten: string[] = []
  const session = createSession({
    api: server.api,
    store,
    home: await temporaryHome(),
    now: () => Date.parse("2030-01-01T00:00:00Z"),
    beforeKeysDiscarded: async () => {
      forgotten.push("discard")
    },
    deviceService: { adopt: async () => undefined, forget: async () => void forgotten.push("forget") },
    machine: { digest: async () => DIGEST, name: () => "build-box", ...(budgetMs === undefined ? {} : { budgetMs }) },
    log: (line) => lines.push(line),
  })
  return { session, memory, lines, forgotten, stored }
}

describe("a refresh binds an unbound device to its machine once (#13651)", () => {
  test("the first refresh sends exactly one verified bind, the second sends none", async () => {
    const server = service({ name: "build-box", bound: false, bindAnswer: "bound" })
    const m = await signedIn("build-box", server)

    await m.session.accessToken()
    expect(server.binds).toHaveLength(1)
    expect(server.binds[0]?.verified).toBe(true)
    expect(server.binds[0]?.body["machineDigest"]).toBe(DIGEST)
    expect(server.binds[0]?.body["issuedAt"]).toBe(Math.floor(Date.parse("2030-01-01T00:00:00Z") / 1000))

    await m.session.accessToken()
    expect(server.binds).toHaveLength(1)
  })

  test("machine_exists logs one line and changes nothing locally", async () => {
    const server = service({ name: "build-box", bound: false, bindAnswer: "machine_exists" })
    const m = await signedIn("build-box", server)

    await m.session.accessToken()
    expect(server.binds).toHaveLength(1)
    const after = m.memory.current()
    expect(after?.device).toEqual(m.stored.device)
    expect(after?.signingPrivateKey).toBe(m.stored.signingPrivateKey)
    expect(after?.accessToken).toBe("access-1")
    expect(m.forgotten).toEqual([])
    expect(m.lines).toHaveLength(1)

    // The refusal is remembered: a later refresh neither re-sends the signed bind nor logs again.
    await m.session.accessToken()
    expect(server.binds).toHaveLength(1)
    expect(m.lines).toHaveLength(1)
  })

  test("a malformed row of another device does not stop this device's bind and rename", async () => {
    const server = service({
      name: "omo CLI on build-box",
      bound: false,
      bindAnswer: "bound",
      others: [{ id: "device-odd", name: "" }, { id: "device-partial" }, "not-a-row"],
    })
    const m = await signedIn("omo CLI on build-box", server)

    await m.session.accessToken()
    expect(server.binds.map((bind) => bind.verified)).toEqual([true])
    expect(server.renames).toHaveLength(1)
    expect(m.lines).toEqual([])
  })

  test("an unreadable row of this device is logged, and nothing is sent", async () => {
    const server = service({ name: "", bound: false, bindAnswer: "bound" })
    const m = await signedIn("omo CLI on build-box", server)

    await m.session.accessToken()
    expect(server.binds).toEqual([])
    expect(server.renames).toEqual([])
    expect(m.lines).toHaveLength(1)
  })

  test("a stalled device list does not hold the refreshed token past the fix-up budget", async () => {
    const stalled = Promise.withResolvers<void>()
    onTestFinished(() => stalled.resolve())
    const server = service({ name: "build-box", bound: false, bindAnswer: "bound", stall: stalled.promise })
    const m = await signedIn("build-box", server, 200)

    const started = performance.now()
    expect(await m.session.accessToken()).toBe("access-1")
    expect(performance.now() - started).toBeLessThan(3_000)
    expect(server.binds).toEqual([])
  })

  test("a bound device, or a service that does not report binding, is never sent a bind", async () => {
    for (const bound of [true, undefined]) {
      const server = service({ name: "build-box", bound, bindAnswer: "bound" })
      const m = await signedIn("build-box", server)
      await m.session.accessToken()
      expect(server.binds).toHaveLength(0)
    }
  })
})

describe("nothing in the post-refresh fix-up outlives its budget (#14081 review)", () => {
  test("the account read for a sign-in that names no account is aborted when the budget runs out", async () => {
    const meAborted = Promise.withResolvers<void>()
    const server = service({
      name: "build-box",
      bound: false,
      bindAnswer: "bound",
      // Answers only once the caller gives up, so the read stays pending unless the budget aborts it.
      me: (request) =>
        new Promise((resolve) =>
          request.signal.addEventListener("abort", () => {
            meAborted.resolve()
            resolve(new Response(null, { status: 499 }))
          }),
        ),
    })
    const m = await signedIn("build-box", server, 200, {})
    expect(m.stored.accountId).toBeUndefined()

    expect(await m.session.accessToken()).toBe("access-1")
    await meAborted.promise
    expect(server.binds).toEqual([])
    expect(m.lines).toEqual([])
  }, 10_000)

  test("a rename that lands while the credential lock is held past the budget writes nothing", async () => {
    const held = Promise.withResolvers<void>()
    let renameSeen = false
    const server = service({
      name: "omo CLI on build-box",
      bound: true,
      bindAnswer: "bound",
      onRename: () => {
        renameSeen = true
      },
    })
    const m = await signedIn("omo CLI on build-box", server, 200, {
      accountId: "acct_42",
      // After the service accepted the rename, the locked re-read waits until the test lets it go.
      store: (inner) => ({
        ...inner,
        readAuthoritative: async () => {
          if (renameSeen) await held.promise
          return inner.readAuthoritative()
        },
      }),
    })

    expect(await m.session.accessToken()).toBe("access-1")
    expect(server.renames).toHaveLength(1)
    held.resolve()
    // The same lock: this section runs only after the rename's section has finished.
    await m.session.update(async () => undefined)
    expect(m.memory.current()?.device.name).toBe("omo CLI on build-box")
    expect(m.lines).toEqual([])
  }, 10_000)
})

describe("reconcileDevice settles without a write or a log once its budget aborts (#14081 review)", () => {
  const own = (fields: Record<string, unknown>) => ({
    devices: [{ id: grant.device.id, current: true, revokedAt: null, ...fields }],
  })

  async function fixup(options: {
    readonly answer: (path: string, init: RequestInit) => Promise<unknown>
    readonly digest?: () => Promise<string | undefined>
  }) {
    const controller = new AbortController()
    const refusalPath = join(await temporaryHome(), "machine-exists.json")
    const requests: string[] = []
    const renamed: string[] = []
    const lines: string[] = []
    const run = reconcileDevice({
      api: "https://service.invalid",
      credentials: {
        ...grant,
        device: { id: grant.device.id, name: "omo CLI on box" },
        ...keys.private,
        accountId: "acct_42",
      },
      machine: { digest: options.digest ?? (async () => DIGEST), name: () => "build-box" },
      nowMs: Date.parse("2030-01-01T00:00:00Z"),
      request: (path, init) => {
        requests.push(`${init.method ?? "GET"} ${path}`)
        return options.answer(path, init)
      },
      accountOf: async () => "acct_42",
      renamed: async (name) => void renamed.push(name),
      refusalPath,
      log: (line) => lines.push(line),
      signal: controller.signal,
    })
    return { controller, run, requests, renamed, lines, refusalPath }
  }

  test("a machine digest that never settles does not hold the fix-up past the budget", async () => {
    const asked = Promise.withResolvers<void>()
    const f = await fixup({
      answer: async () => own({ name: "build-box", machineBound: false }),
      digest: () => {
        asked.resolve()
        return new Promise<never>(() => undefined)
      },
    })

    await asked.promise
    f.controller.abort()
    await f.run
    expect(f.requests).toEqual(["GET /v1/devices"])
    expect(f.lines).toEqual([])
  })

  test("a rename accepted right after the budget ran out is not recorded and not logged", async () => {
    const asked = Promise.withResolvers<void>()
    const reply = Promise.withResolvers<unknown>()
    const f = await fixup({
      answer: async (path, init) => {
        if (init.method !== "PATCH") return own({ name: "omo CLI on box", machineBound: true })
        asked.resolve()
        return reply.promise
      },
    })

    await asked.promise
    f.controller.abort()
    reply.resolve(null)
    await f.run
    expect(f.requests).toEqual(["GET /v1/devices", `PATCH /v1/devices/${grant.device.id}`])
    expect(f.renamed).toEqual([])
    expect(f.lines).toEqual([])
  })

  test("a machine_exists refusal landing right after the budget ran out is neither remembered nor logged", async () => {
    const asked = Promise.withResolvers<void>()
    const reply = Promise.withResolvers<unknown>()
    const f = await fixup({
      answer: async (path, init) => {
        if (init.method !== "PUT") return own({ name: "build-box", machineBound: false })
        asked.resolve()
        return reply.promise
      },
    })

    await asked.promise
    f.controller.abort()
    reply.reject(new ApiRefusal("machine_exists", 409))
    await f.run
    expect(f.requests).toEqual(["GET /v1/devices", "PUT /v1/devices/current/machine"])
    expect(await Bun.file(f.refusalPath).exists()).toBe(false)
    expect(f.lines).toEqual([])
  })
})

describe("a refresh renames a generated device label to the machine name once (#13651, #14044)", () => {
  test("`omo CLI on <host>` becomes the machine name, and the stored credential follows", async () => {
    const server = service({ name: "omo CLI on build-box.local", bound: true, bindAnswer: "bound" })
    const m = await signedIn("omo CLI on build-box.local", server)

    await m.session.accessToken()
    expect(server.renames).toEqual([{ path: `/v1/devices/${grant.device.id}`, body: { name: "build-box" } }])
    expect(m.memory.current()?.device.name).toBe("build-box")

    await m.session.accessToken()
    expect(server.renames).toHaveLength(1)
  })

  test("a name the person chose is never renamed", async () => {
    const server = service({ name: "Work laptop", bound: true, bindAnswer: "bound" })
    const m = await signedIn("Work laptop", server)

    await m.session.accessToken()
    await m.session.accessToken()
    expect(server.renames).toEqual([])
    expect(m.memory.current()?.device.name).toBe("Work laptop")
  })

  test("a label the person renamed on the Devices page is kept even when the stored copy is still generated", async () => {
    const server = service({ name: "Work laptop", bound: true, bindAnswer: "bound" })
    const m = await signedIn("omo CLI on build-box", server)

    await m.session.accessToken()
    expect(server.renames).toEqual([])
  })
})
