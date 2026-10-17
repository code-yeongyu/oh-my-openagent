import { expect, onTestFinished, spyOn, test } from "bun:test"
import { createSession } from "./session"
import { fakeApi, grant, memorySecrets, privateKeys, refusal, temporaryHome } from "./test-support"

const expired = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }

for (const code of ["ENOTFOUND", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ConnectionRefused"]) {
  test(`refresh preserves credentials and can retry after connect failure ${code}`, async () => {
    const api = fakeApi(() => Response.json({ ...grant, refreshToken: "rotated" }))
    const store = memorySecrets().store(api)
    await store.write(expired)
    const session = createSession({ api, store, home: await temporaryHome() })
    const fetcher = spyOn(globalThis, "fetch").mockRejectedValueOnce(Object.assign(new Error(grant.refreshToken), { code }))
    onTestFinished(() => fetcher.mockRestore())
    const error = await session.accessToken().catch(error => error)
    expect(error).toMatchObject({ retryable: true })
    expect(await store.read()).toEqual(expired)
    expect(await session.accessToken()).toBe(grant.accessToken)
  })
}

for (const mode of ["500", "502", "500-terminal-code", "lost-response", "timeout", "invalid-json", "invalid-grant-shape"]) {
  test(`refresh retains keys but never resends a possibly consumed token after ${mode}`, async () => {
    let requests = 0
    const api = fakeApi(() => {
      requests++
      if (mode === "500-terminal-code") return refusal("unauthorized", undefined, 500)
      if (mode === "500" || mode === "502") return refusal("internal", undefined, Number(mode))
      if (mode === "invalid-json") return new Response("not json")
      return Response.json({})
    })
    const store = memorySecrets().store(api)
    await store.write(expired)
    const home = await temporaryHome()
    let sent = 0
    if (mode === "lost-response" || mode === "timeout") {
      const fetcher = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => {
        sent++
        throw mode === "timeout" ? new DOMException("synthetic timeout", "TimeoutError") : new TypeError("response lost")
      }, { preconnect: globalThis.fetch.preconnect }))
      onTestFinished(() => fetcher.mockRestore())
    }
    await expect(createSession({ api, store, home }).accessToken()).rejects.toThrow()
    expect(await store.read()).toMatchObject({ ...expired, refreshState: "uncertain" })
    await expect(createSession({ api, store, home }).accessToken()).rejects.toThrow()
    expect(requests + sent).toBe(1)
  })
}

test("explicit invalid_grant refresh refusal clears credentials", async () => {
  const api = fakeApi(() => refusal("invalid_grant"))
  const store = memorySecrets().store(api)
  await store.write(expired)
  await expect(createSession({ api, store, home: await temporaryHome() }).accessToken()).rejects.toThrow()
  expect(await store.read()).toBeNull()
})

test("failed rotated-token persistence retains the pre-send uncertainty marker", async () => {
  let requests = 0
  const api = fakeApi(() => { requests++; return Response.json({ ...grant, refreshToken: "rotated" }) })
  const base = memorySecrets().store(api)
  await base.write(expired)
  const store = { ...base, write: async (value: Parameters<typeof base.write>[0]) => {
    if (value.refreshToken === "rotated") throw new Error("synthetic store failure")
    await base.write(value)
  } }
  const home = await temporaryHome()
  await expect(createSession({ api, store, home }).accessToken()).rejects.toThrow()
  expect(await base.read()).toMatchObject({ ...expired, refreshState: "uncertain" })
  await expect(createSession({ api, store: base, home }).accessToken()).rejects.toThrow()
  expect(requests).toBe(1)
})

test("failed pre-send journal persistence sends no rotating request", async () => {
  let requests = 0
  const api = fakeApi(() => { requests++; return Response.json(grant) })
  const base = memorySecrets().store(api)
  await base.write(expired)
  const store = { ...base, write: async () => { throw new Error("synthetic store failure") } }
  await expect(createSession({ api, store, home: await temporaryHome() }).accessToken()).rejects.toThrow()
  expect(requests).toBe(0)
  expect(await base.read()).toEqual(expired)
})

for (const outcome of ["approved", "offline", "refused"]) {
  test(`logout attempts access-authenticated device revocation and clears locally when ${outcome}`, async () => {
    const calls: string[] = []
    const api = fakeApi(request => {
      calls.push(`${request.method} ${new URL(request.url).pathname}`)
      if (request.url.endsWith("/v1/session/refresh")) return Response.json({ ...grant, refreshToken: "rotated" })
      expect(request.headers.get("authorization")).toBe(`Bearer ${grant.accessToken}`)
      return outcome === "refused" ? refusal("unauthorized", undefined, 401) : new Response(null, { status: 204 })
    })
    let attempts = 0
    if (outcome === "offline") {
      const fetcher = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => {
        attempts++
        throw Object.assign(new Error("offline"), { code: "ENETUNREACH" })
      }, { preconnect: globalThis.fetch.preconnect }))
      onTestFinished(() => fetcher.mockRestore())
    }
    const store = memorySecrets().store(api)
    await store.write(expired)
    const result = await createSession({ api, store, home: await temporaryHome() }).logout()
    expect(await store.read()).toBeNull()
    expect(result).toBe(outcome === "approved")
    expect(outcome === "offline" ? attempts : calls).toEqual(outcome === "offline" ? 1 : ["POST /v1/session/refresh", "DELETE /v1/devices/device-1"])
  })
}
