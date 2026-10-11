import { describe, expect, test } from "bun:test"
import { createHash, createPrivateKey, createPublicKey } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { loginLoopback } from "./loopback"
import { createSession } from "./session"
import { fakeApi, grant, memorySecrets, temporaryHome } from "./test-support"

describe("loopback sign-in", () => {
  test("rejects wrong state, proves PKCE, exchanges public keys, stores private keys only in keystore", async () => {
    const home = await temporaryHome()
    const secrets = memorySecrets()
    let challenge = ""
    let signingKey = ""
    let sealingKey = ""
    let exchanges = 0
    const api = fakeApi(async (request) => {
      expect(new URL(request.url).pathname).toBe("/v1/session/exchange")
      const body = await request.json()
      expect(body.kind).toBe("cli")
      expect(body).not.toHaveProperty("client_id")
      expect(body.codeVerifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
      expect(createHash("sha256").update(body.codeVerifier).digest("base64url")).toBe(challenge)
      expect(body.signingKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(body.sealingKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
      signingKey = body.signingKey
      sealingKey = body.sealingKey
      exchanges++
      return Response.json(grant)
    })
    const session = createSession({ api, store: secrets.store(api), home })
    await loginLoopback(session, {
      accounts: "https://accounts.omo.dev", name: "Test CLI", platform: "macos",
      open: async (url) => {
        const authorize = new URL(url)
        expect(authorize.pathname).toBe("/")
        expect(authorize.searchParams.get("code_challenge_method")).toBe("S256")
        expect(authorize.searchParams.has("client_id")).toBe(false)
        challenge = authorize.searchParams.get("code_challenge") ?? ""
        const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "")
        expect(callback.hostname).toBe("127.0.0.1")
        expect(Number(callback.port)).toBeGreaterThan(0)
        callback.searchParams.set("code", "one-use-code")
        callback.searchParams.set("state", "wrong")
        expect((await fetch(callback, { proxy: "" })).status).toBe(400)
        expect(exchanges).toBe(0)
        callback.searchParams.set("state", authorize.searchParams.get("state") ?? "")
        expect((await fetch(callback, { method: "POST" })).status).toBe(404)
        expect((await fetch(callback, { headers: { forwarded: "for=203.0.113.1" } })).status).toBe(404)
        expect((await fetch(callback, { headers: { host: "localhost" } })).status).toBe(404)
        callback.searchParams.append("state", authorize.searchParams.get("state") ?? "")
        expect((await fetch(callback)).status).toBe(400)
        callback.searchParams.set("state", authorize.searchParams.get("state") ?? "")
        expect((await fetch(callback, { proxy: "" })).status).toBe(200)
        return true
      },
      chooseDevice: async () => null,
    })
    expect(exchanges).toBe(1)
    const saved = await secrets.store(api).read()
    expect(saved?.refreshToken).toBe(grant.refreshToken)
    expect(saved?.signingPrivateKey).toBeString()
    if (!saved) throw new Error("missing credentials")
    const pub = createPublicKey(createPrivateKey({ key: Buffer.from(saved.signingPrivateKey, "base64"), format: "der", type: "pkcs8" }))
    expect(pub.asymmetricKeyType).toBe("ed25519")
    expect(pub.export({ format: "jwk" }).x).toBe(signingKey)
    const sealing = createPublicKey(createPrivateKey({ key: Buffer.from(saved.sealingPrivateKey, "base64"), format: "der", type: "pkcs8" }))
    expect(sealing.asymmetricKeyType).toBe("x25519")
    expect(sealing.export({ format: "jwk" }).x).toBe(sealingKey)
    const files = await readdir(home, { recursive: true })
    for (const file of files) {
      if (!file.endsWith(".lock")) continue
      expect(await readFile(join(home, file), "utf8")).not.toContain(grant.refreshToken)
    }
    expect(files.filter(file => !file.startsWith(".omo"))).toEqual([])
  })

  test("device-limit recovery starts a new authorization instead of reusing a code", async () => {
    const secrets = memorySecrets()
    const codes: string[] = []
    let opened = 0
    const { limitDetail, refusal } = await import("./test-support")
    const api = fakeApi(async request => {
      const path = new URL(request.url).pathname
      if (path === "/v1/devices") return Response.json({ devices: [{ id: "old", name: "Old CLI", revokedAt: null }], browsers: [] })
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      const body = await request.json()
      codes.push(body.code)
      return codes.length === 1 ? refusal("entitlement_required", limitDetail, 403) : Response.json(grant)
    })
    await loginLoopback(createSession({ api, store: secrets.store(api), home: await temporaryHome() }), {
      accounts: "https://accounts.omo.dev", name: "Test", platform: "linux",
      chooseDevice: async () => "old",
      open: async url => {
        const ask = new URL(url)
        const callback = new URL(ask.searchParams.get("redirect_uri") ?? "")
        callback.searchParams.set("state", ask.searchParams.get("state") ?? "")
        callback.searchParams.set("code", `code-${++opened}`)
        await fetch(callback, { proxy: "" })
        return true
      },
    })
    expect(codes).toEqual(["code-1", "code-2"])
  })
})
