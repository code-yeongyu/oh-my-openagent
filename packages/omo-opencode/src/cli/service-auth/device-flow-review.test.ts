import { expect, test } from "bun:test"
import { loginDevice } from "./device-flow"
import { createSession } from "./session"
import { clock, fakeApi, grant, memorySecrets, minted, refusal, temporaryHome } from "./test-support"

test("device polling stops immediately on off-contract 401 reauth_required", async () => {
  let polls = 0
  const api = fakeApi(request => {
    if (request.url.endsWith("/code")) return Response.json(minted)
    polls++
    return refusal("reauth_required", undefined, 401)
  })
  await expect(loginDevice(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
    name: "Test", platform: "linux", ...clock(), show: () => {}, chooseDevice: async () => null,
  })).rejects.toThrow()
  expect(polls).toBe(1)
})

for (const verificationUri of ["javascript:alert(1)", "file:///tmp/test", "http://example.com/device", "http://localhost:8080/device", "http://127.0.0.1/device"]) {
  test(`device verification rejects unsafe scheme or host ${verificationUri}`, async () => {
    let shown = false
    let polls = 0
    const api = fakeApi(request => {
      if (request.url.endsWith("/code")) return Response.json({ ...minted, verificationUri })
      polls++
      return Response.json(grant)
    })
    await expect(loginDevice(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
      name: "Test", platform: "linux", ...clock(), show: () => { shown = true }, chooseDevice: async () => null,
    })).rejects.toThrow()
    expect(shown).toBe(false)
    expect(polls).toBe(0)
  })
}

test("device display strips terminal sequences without rewriting a normal verification query", async () => {
  const verificationUri = `${minted.verificationUri}&x=\u001b[31mred\u001b[0m\u0007`
  const api = fakeApi(request => Response.json(request.url.endsWith("/code") ? { ...minted, verificationUri } : grant))
  const shown: string[] = []
  await loginDevice(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
    name: "Test", platform: "linux", ...clock(), show: code => { shown.push(code.verificationUri) }, chooseDevice: async () => null,
  })
  expect(shown).toEqual([`${minted.verificationUri}&x=red`])
})

for (const retryAfter of ["12", "999999999", "Tue, 01 Jan 2030 00:00:17 GMT", "invalid", "0", "-1", ""]) {
  test(`device polling backs off 429 with bounded Retry-After ${retryAfter || "absent"}`, async () => {
    const time = clock()
    let polls = 0
    const api = fakeApi(request => {
      if (request.url.endsWith("/code")) return Response.json(minted)
      if (++polls > 1) return Response.json(grant)
      const response = refusal("rate_limited", undefined, 429)
      if (retryAfter) response.headers.set("retry-after", retryAfter)
      return response
    })
    await loginDevice(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
      name: "Test", platform: "linux", ...time, show: () => {}, chooseDevice: async () => null,
    })
    const delay = retryAfter === "999999999" ? 60_000 : retryAfter === "12" || retryAfter.startsWith("Tue") ? 12_000 : 10_000
    expect(time.delays).toEqual([5000, delay])
    expect(polls).toBe(2)
  })
}

test("429 backoff stops at absolute device expiry without another poll", async () => {
  const time = clock()
  let polls = 0
  const api = fakeApi(request => {
    if (request.url.endsWith("/code")) return Response.json({ ...minted, expiresAt: "2030-01-01T00:00:20Z" })
    polls++
    const response = refusal("rate_limited", undefined, 429)
    response.headers.set("retry-after", "60")
    return response
  })
  await expect(loginDevice(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
    name: "Test", platform: "linux", ...time, show: () => {}, chooseDevice: async () => null,
  })).rejects.toThrow()
  expect(time.delays).toEqual([5000, 15000])
  expect(polls).toBe(1)
})
