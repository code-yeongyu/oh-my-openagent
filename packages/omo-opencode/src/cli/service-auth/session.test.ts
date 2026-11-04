import { describe, expect, mock, onTestFinished, spyOn, test } from "bun:test"
import * as credentialLock from "./credential-lock"
import { createCredentialStore, CredentialIdentityChanged, type CredentialStore, InvalidCredentialState } from "./keystore"
import type { Credentials } from "./protocol"
import { createSession, SessionEnded } from "./session"
import { fakeApi, grant, memorySecrets, privateKeys, refusal, temporaryHome } from "./test-support"

const NOW = Date.parse("2030-01-01T00:00:00Z")
const captured: Credentials = { ...grant, ...privateKeys, accountId: "account-a", credentialGeneration: "generation-a" }
const sameIdentity = (current: Credentials) => current.accountId === captured.accountId
  && current.credentialGeneration === captured.credentialGeneration
  && current.device.id === captured.device.id
  && current.signingPrivateKey === captured.signingPrivateKey
  && current.sealingPrivateKey === captured.sealingPrivateKey

async function tokenHarness(snapshot: Credentials, authoritative = snapshot) {
  let current: Credentials | null = authoritative
  const bodies: unknown[] = []
  const refresh = mock(async (request: Request) => {
    bodies.push(await request.json())
    return Response.json({ ...grant, accessToken: "refreshed-access" })
  })
  const api = fakeApi(refresh)
  const store = {
    read: mock(async () => snapshot),
    readAuthoritative: mock(async () => current),
    write: mock(async (value: Credentials) => { current = value }),
    clear: mock(async () => { current = null }),
  } satisfies CredentialStore
  const lock = spyOn(credentialLock, "withCredentialLock")
  onTestFinished(() => lock.mockRestore())
  const session = createSession({ api, store, home: await temporaryHome(), now: () => NOW })
  return { session, store, lock, refresh, bodies }
}

describe("access token identity and refresh paths", () => {
  test("valid same-identity snapshot returns without locking or refreshing", async () => {
    const h = await tokenHarness({ ...captured, accessTokenExpiresAt: new Date(NOW + 30_001).toISOString() })
    expect(await h.session.accessToken(sameIdentity)).toBe(captured.accessToken)
    expect(h.lock).not.toHaveBeenCalled()
    expect(h.store.readAuthoritative).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })

  for (const remaining of [-1, 30_000]) {
    test(`token with ${remaining}ms remaining locks, reads authoritatively and refreshes`, async () => {
      const stale = { ...captured, accessTokenExpiresAt: new Date(NOW + remaining).toISOString() }
      const h = await tokenHarness(stale, { ...stale, refreshToken: "authoritative-refresh" })
      expect(await h.session.accessToken(sameIdentity)).toBe("refreshed-access")
      expect(h.lock).toHaveBeenCalledTimes(1)
      expect(h.store.readAuthoritative).toHaveBeenCalledTimes(1)
      expect(h.refresh).toHaveBeenCalledTimes(1)
      expect(h.bodies).toEqual([{ refreshToken: "authoritative-refresh" }])
    })
  }

  test("identity change on authoritative refresh rejects before dispatch", async () => {
    const stale = { ...captured, accessTokenExpiresAt: new Date(NOW).toISOString() }
    const h = await tokenHarness(stale, { ...stale, credentialGeneration: "generation-b" })
    await expect(h.session.accessToken(sameIdentity)).rejects.toBeInstanceOf(CredentialIdentityChanged)
    expect(h.lock).toHaveBeenCalledTimes(1)
    expect(h.store.readAuthoritative).toHaveBeenCalledTimes(1)
    expect(h.refresh).not.toHaveBeenCalled()
    expect(h.store.write).not.toHaveBeenCalled()
  })

  test("valid snapshot with different identity cannot bypass authoritative guard", async () => {
    const other = { ...captured, accountId: "account-b" }
    const h = await tokenHarness(other)
    await expect(h.session.accessToken(sameIdentity)).rejects.toBeInstanceOf(CredentialIdentityChanged)
    expect(h.lock).toHaveBeenCalledTimes(1)
    expect(h.store.readAuthoritative).toHaveBeenCalledTimes(1)
    expect(h.refresh).not.toHaveBeenCalled()
  })
})

describe("credential lifecycle", () => {
  test("accessToken surfaces corrupt-credential recovery without locking or changing storage", async () => {
    const store = createCredentialStore("https://api.omo.dev", { platform: "darwin", secrets: {
      get: async () => "{",
      set: async () => { throw new Error("unexpected write") },
      delete: async () => { throw new Error("unexpected delete") },
    } })
    const lock = spyOn(credentialLock, "withCredentialLock")
    onTestFinished(() => lock.mockRestore())
    const session = createSession({ api: "https://api.omo.dev", store, home: await temporaryHome() })
    const error = await session.accessToken(sameIdentity).catch(error => error)
    expect(error).toBeInstanceOf(InvalidCredentialState)
    expect(error.message).toBe("The OmO sign-in saved on this computer can't be read. Run omo account forget to remove it, then sign in again in the desktop app.")
    expect(lock).not.toHaveBeenCalled()
  })

  test("scoped update refuses corrupt ownership and clears only its own readable scope afterward", async () => {
    const secrets = memorySecrets()
    const api = "https://api.omo.dev"
    const store = secrets.store(api)
    const other = secrets.store("https://other.example")
    await store.write(captured)
    await other.write({ ...captured, device: { ...captured.device, id: "other-device" } })
    const otherBefore = await other.read()
    const slot = [...secrets.values.keys()].find(key => JSON.parse(secrets.values.get(key) ?? "{}").device?.id === captured.device.id)
    if (slot === undefined) throw new Error("the captured account was not stored")
    secrets.values.set(slot, "{")
    const session = createSession({ api, store, home: await temporaryHome() })
    let actions = 0
    const forgetCaptured = () => session.update(async current => {
      actions++
      if (current?.device.id !== captured.device.id) return false
      await store.clear()
      return true
    })
    await expect(forgetCaptured()).rejects.toBeInstanceOf(InvalidCredentialState)
    expect(actions).toBe(0)
    expect(secrets.values.get(slot)).toBe("{")
    await store.write(captured)
    expect(await forgetCaptured()).toBe(true)
    expect(await store.read()).toBeNull()
    expect(await other.read()).toEqual(otherBefore)
  })

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
      const error = await session.accessToken().catch(error => error)
      expect(error).toBeInstanceOf(SessionEnded)
      expect(error).toMatchObject({ code, deviceRevoked: code !== "unauthorized" })
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
    const persisted = await store.read()
    const session = createSession({
      api, home: await temporaryHome(),
      store: { ...store, write: async () => { throw new Error("store unavailable") } },
    })
    await expect(session.accessToken()).rejects.toThrow()
    expect(await store.read()).toEqual(persisted)
  })
})
