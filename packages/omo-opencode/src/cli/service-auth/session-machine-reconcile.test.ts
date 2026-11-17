import { describe, expect, test } from "bun:test"
import { createPublicKey, verify } from "node:crypto"
import type { CredentialStore } from "./keystore"
import { generateDeviceKeys } from "./device-keys"
import type { Credentials } from "./protocol"
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

type Service = { name: string; bound: boolean | undefined; bindAnswer: "bound" | "machine_exists" }

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
      return Response.json({
        devices: [
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
    if (request.method === "PATCH" && pathname.startsWith("/v1/devices/")) {
      const body = (await request.json()) as { name: string }
      renames.push({ path: pathname, body })
      state.name = body.name
      return new Response(null, { status: 204 })
    }
    return refusal("not_found", undefined, 404)
  })
  return { api, state, binds, renames }
}

async function signedIn(name: string, server: ReturnType<typeof service>) {
  const stored: Credentials = {
    ...grant,
    ...expiredTokens,
    device: { id: grant.device.id, name },
    ...keys.private,
    accountId: "acct_42",
  }
  const memory = memoryStore(stored)
  const lines: string[] = []
  const forgotten: string[] = []
  const session = createSession({
    api: server.api,
    store: memory.store,
    home: await temporaryHome(),
    now: () => Date.parse("2030-01-01T00:00:00Z"),
    beforeKeysDiscarded: async () => {
      forgotten.push("discard")
    },
    deviceService: { adopt: async () => undefined, forget: async () => void forgotten.push("forget") },
    machine: { digest: async () => DIGEST, name: () => "build-box" },
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
