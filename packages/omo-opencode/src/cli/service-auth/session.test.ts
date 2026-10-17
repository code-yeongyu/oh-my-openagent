import { describe, expect, test } from "bun:test"
import { createSession } from "./session"
import { fakeApi, grant, memorySecrets, privateKeys, refusal, temporaryHome } from "./test-support"

describe("credential lifecycle", () => {
  test("rotates once for concurrent requests and awaits durable replacement before returning access", async () => {
    const secrets = memorySecrets()
    const stored = Promise.withResolvers<void>()
    const permit = Promise.withResolvers<void>()
    let refreshes = 0
    const api = fakeApi(async request => {
      expect(new URL(request.url).pathname).toBe("/v1/session/refresh")
      expect(await request.json()).toEqual({ refreshToken: grant.refreshToken })
      refreshes++
      return Response.json({ ...grant, accessToken: "new-access", refreshToken: "new-refresh" })
    })
    const baseStore = secrets.store(api)
    await baseStore.write({ ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00.000Z" })
    const home = await temporaryHome()
    const store = {
      ...baseStore,
      write: async (value: Parameters<typeof baseStore.write>[0]) => {
        stored.resolve()
        await permit.promise
        await baseStore.write(value)
      },
    }
    const first = createSession({ api, store, home })
    const second = createSession({ api, store, home })
    let delivered = false
    const a = first.accessToken().then(value => { delivered = true; return value })
    await stored.promise
    const b = second.accessToken()
    expect(delivered).toBe(false)
    expect((await baseStore.read())?.refreshToken).toBe(grant.refreshToken)
    permit.resolve()
    expect(await Promise.all([a, b])).toEqual(["new-access", "new-access"])
    expect(refreshes).toBe(1)
    expect((await baseStore.read())?.refreshToken).toBe("new-refresh")
  })

  for (const code of ["unauthorized", "account_deleted", "reauth_required"]) {
    test(`${code} clears tokens and keys and requires sign-in`, async () => {
      const secrets = memorySecrets()
      const api = fakeApi(() => refusal(code, undefined, code === "account_deleted" ? 410 : 401))
      const store = secrets.store(api)
      await store.write({ ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" })
      const session = createSession({ api, store, home: await temporaryHome() })
      await expect(session.accessToken()).rejects.toThrow(code === "reauth_required" ? "session was ended" : "Sign in again")
      expect(await store.read()).toBeNull()
    })
  }

  test("logout clears tokens and private keys", async () => {
    const secrets = memorySecrets()
    const api = fakeApi(() => new Response(null, { status: 204 }))
    const store = secrets.store(api)
    await store.write({ ...grant, ...privateKeys })
    await createSession({ api, store, home: await temporaryHome() }).logout()
    expect(secrets.values.size).toBe(0)
  })

  test("a failed rotation persistence never releases the new access token", async () => {
    const secrets = memorySecrets()
    const api = fakeApi(() => Response.json({ ...grant, refreshToken: "rotated" }))
    const store = secrets.store(api)
    await store.write({ ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" })
    const session = createSession({
      api, home: await temporaryHome(),
      store: { ...store, write: async () => { throw new Error("store unavailable") } },
    })
    await expect(session.accessToken()).rejects.toThrow()
    expect(await store.read()).toEqual({ ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" })
  })
})
