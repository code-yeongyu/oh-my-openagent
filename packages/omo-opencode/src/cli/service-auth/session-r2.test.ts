import { expect, onTestFinished, spyOn, test } from "bun:test"
import { inspect } from "node:util"
import { createSession } from "./session"
import { SignInError } from "./protocol"
import { fakeApi, grant, memorySecrets, privateKeys, refusal, temporaryHome } from "./test-support"

const expired = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }
const notSentCodes = [
  "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_NOT_YET_VALID",
  "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED", "CERT_REJECTED", "ERR_TLS_HANDSHAKE_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT", "EADDRNOTAVAIL", "ENETDOWN", "EHOSTDOWN",
]

for (const code of notSentCodes) {
  test(`TLS or connect-phase ${code} preserves retryable credentials`, async () => {
    const api = fakeApi(() => Response.json({ ...grant, refreshToken: "rotated" }))
    const store = memorySecrets().store(api)
    await store.write(expired)
    const fetcher = spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("fetch failed", { cause: Object.assign(new Error("connection rejected"), { code }) }))
    onTestFinished(() => fetcher.mockRestore())
    const session = createSession({ api, store, home: await temporaryHome() })
    const error: unknown = await session.accessToken().catch(error => error)
    expect(error).toMatchObject({ notSent: true, retryable: true })
    expect(await store.read()).toEqual(expired)
    expect(await session.accessToken()).toBe(grant.accessToken)
  })
}

for (const code of ["ECONNRESET", "ETIMEDOUT"]) {
  test(`phase-ambiguous ${code} still blocks refresh replay`, async () => {
    const api = fakeApi(() => Response.json(grant))
    const store = memorySecrets().store(api)
    await store.write(expired)
    const fetcher = spyOn(globalThis, "fetch").mockRejectedValueOnce(Object.assign(new Error("unknown phase"), { code }))
    onTestFinished(() => fetcher.mockRestore())
    await expect(createSession({ api, store, home: await temporaryHome() }).accessToken()).rejects.toThrow()
    expect(await store.read()).toMatchObject({ ...expired, refreshState: "uncertain" })
  })
}

for (const code of ["unauthorized", "account_deleted", "invalid_grant", "reauth_required"]) {
  test(`terminal ${code} refusal hides tokens in every error representation`, async () => {
    const api = fakeApi(() => refusal(code, undefined, code === "account_deleted" ? 410 : code === "invalid_grant" ? 400 : 401))
    const store = memorySecrets().store(api)
    await store.write(expired)
    const error: unknown = await createSession({ api, store, home: await temporaryHome() }).accessToken().catch(error => error)
    expect(error).toBeInstanceOf(SignInError)
    expect(await store.read()).toBeNull()
    for (const secret of [grant.accessToken, grant.refreshToken, ...Object.values(privateKeys)]) {
      expect(`${String(error)} ${inspect(error)} ${JSON.stringify(error)}`).not.toContain(secret)
    }
  })
}

test("refresh 429 restores the original record and a later retry succeeds", async () => {
  let refreshes = 0
  const api = fakeApi(() => ++refreshes === 1 ? refusal("rate_limited", undefined, 429)
    : Response.json({ ...grant, refreshToken: "rotated" }))
  const store = memorySecrets().store(api)
  await store.write(expired)
  const session = createSession({ api, store, home: await temporaryHome() })
  const error: unknown = await session.accessToken().catch(error => error)
  expect(error).toMatchObject({ retryable: true })
  expect(await store.read()).toEqual(expired)
  expect(await session.accessToken()).toBe(grant.accessToken)
  expect(refreshes).toBe(2)
})

test("failed not-sent restoration retains the durable fence without replay or secret loss", async () => {
  const api = fakeApi(() => Response.json(grant))
  const base = memorySecrets().store(api)
  await base.write(expired)
  let writes = 0
  const store = { ...base, write: async (value: Parameters<typeof base.write>[0]) => {
    if (++writes > 1) throw new SignInError("OS store unavailable")
    await base.write(value)
  } }
  const fetcher = spyOn(globalThis, "fetch").mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "ECONNREFUSED" }))
  onTestFinished(() => fetcher.mockRestore())
  const home = await temporaryHome()
  await expect(createSession({ api, store, home }).accessToken()).rejects.toThrow()
  expect(await base.read()).toMatchObject({ ...expired, refreshState: "uncertain" })
  await expect(createSession({ api, store: base, home }).accessToken()).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(writes).toBe(2)
})

for (const outcome of ["approved", "refresh-refused", "revoke-refused", "save-failed", "uncertain"]) {
  test(`expired logout ${outcome} keeps the safe refresh-revoke-clear ordering`, async () => {
    const calls: string[] = []
    const bearers: string[] = []
    let savedRefreshAtRevoke: string | undefined
    const secrets = memorySecrets()
    const api = fakeApi(async request => {
      const path = new URL(request.url).pathname
      calls.push(`${request.method} ${path}`)
      if (path === "/v1/session/refresh") {
        expect(await request.json()).toEqual({ refreshToken: grant.refreshToken })
        return outcome === "refresh-refused" ? refusal("unauthorized", undefined, 401)
          : Response.json({ ...grant, accessToken: "new-access", refreshToken: "new-refresh" })
      }
      bearers.push(request.headers.get("authorization") ?? "")
      savedRefreshAtRevoke = (await secrets.store(api).read())?.refreshToken
      return outcome === "revoke-refused" ? refusal("unauthorized", undefined, 401) : new Response(null, { status: 204 })
    })
    const base = secrets.store(api)
    await base.write(outcome === "uncertain" ? { ...expired, refreshState: "uncertain" } : expired)
    const store = { ...base, write: async (value: Parameters<typeof base.write>[0]) => {
      if (outcome === "save-failed" && value.refreshToken === "new-refresh") throw new SignInError("OS store unavailable")
      await base.write(value)
    } }
    expect(await createSession({ api, store, home: await temporaryHome() }).logout()).toBe(outcome === "approved")
    expect(await base.read()).toBeNull()
    expect(calls).toEqual(outcome === "uncertain" ? []
      : ["POST /v1/session/refresh", ...(["refresh-refused", "save-failed"].includes(outcome) ? [] : ["DELETE /v1/devices/device-1"])])
    if (outcome === "approved" || outcome === "revoke-refused") {
      expect(bearers).toEqual(["Bearer new-access"])
      expect(savedRefreshAtRevoke).toBe("new-refresh")
    } else expect(bearers).toEqual([])
  })
}
