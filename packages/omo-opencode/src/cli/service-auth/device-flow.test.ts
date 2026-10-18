import { describe, expect, test } from "bun:test"
import { loginDevice } from "./device-flow"
import { createSession } from "./session"
import { clock, fakeApi, grant, limitDetail, memorySecrets, minted, refusal, temporaryHome } from "./test-support"

describe("device authorization", () => {
  test("prints server URI and both codes, backs off pending/slow_down, and persists approval", async () => {
    const time = clock()
    const secrets = memorySecrets()
    const outcomes = ["authorization_pending", "slow_down", "approved"]
    const seen: unknown[] = []
    const api = fakeApi(async request => {
      const body = await request.json()
      seen.push(body)
      if (request.url.endsWith("/code")) {
        expect(body).toEqual({ client: { name: "Test CLI", platform: "linux" } })
        return Response.json(minted)
      }
      expect(body).not.toHaveProperty("userCode")
      expect(body.deviceCode).toBe(minted.deviceCode)
      const outcome = outcomes.shift()
      return outcome === "approved" ? Response.json(grant) : refusal(outcome ?? "invalid_grant")
    })
    const shown: unknown[] = []
    await loginDevice(createSession({ api, store: secrets.store(api), home: await temporaryHome() }), {
      name: "Test CLI", platform: "linux", ...time,
      show: value => { shown.push(value) }, chooseDevice: async () => null,
    })
    expect(time.delays).toEqual([5000, 5000, 10000])
    expect(shown).toEqual([{ verificationUri: minted.verificationUri, userCode: minted.userCode, matchingCode: minted.matchingCode }])
    expect(JSON.stringify(shown)).not.toContain(minted.deviceCode)
    expect((await secrets.store(api).read())?.accessToken).toBe(grant.accessToken)
    expect(seen).toHaveLength(4)
  })

  for (const code of ["access_denied", "expired_token", "invalid_grant"]) {
    test(`stops on ${code} without minting or polling again`, async () => {
      let polls = 0
      const secrets = memorySecrets()
      const api = fakeApi(request => {
        if (request.url.endsWith("/code")) return Response.json(minted)
        polls++
        return refusal(code)
      })
      await expect(loginDevice(createSession({ api, store: secrets.store(api), home: await temporaryHome() }), {
        name: "Test", platform: "linux", ...clock(), show: () => {}, chooseDevice: async () => null,
      })).rejects.toThrow()
      expect(polls).toBe(1)
      expect(secrets.writes).toHaveLength(0)
    })
  }

  test("stops at expiresAt without one late poll", async () => {
    const time = clock()
    let polls = 0
    const api = fakeApi(request => {
      if (request.url.endsWith("/code")) return Response.json({ ...minted, expiresAt: "2030-01-01T00:00:05.000Z" })
      polls++
      return refusal("authorization_pending")
    })
    await expect(loginDevice(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
      name: "Test", platform: "linux", ...time, show: () => {}, chooseDevice: async () => null,
    })).rejects.toThrow()
    expect(polls).toBe(0)
    expect(time.delays).toEqual([5000])
  })

  for (const chosen of ["old", null]) {
    test(`device limit ${chosen === null ? "decline changes nothing" : "lists, revokes selected device, retries same approved code"}`, async () => {
      const calls: string[] = []
      let polls = 0
      const secrets = memorySecrets()
      const api = fakeApi(async request => {
        const path = new URL(request.url).pathname
        calls.push(`${request.method} ${path}`)
        if (path === "/v1/device/code") return Response.json(minted)
        if (path === "/v1/device/token") {
          expect((await request.json()).deviceCode).toBe(minted.deviceCode)
          return ++polls === 1 ? refusal("entitlement_required", limitDetail, 403) : Response.json(grant)
        }
        expect(request.headers.get("authorization")).toBe(`Bearer ${limitDetail.managementToken}`)
        return request.method === "DELETE" ? new Response(null, { status: 204 })
          : Response.json({ devices: [{ id: "old", name: "Old", revokedAt: null }], browsers: [] })
      })
      const result = loginDevice(createSession({ api, store: secrets.store(api), home: await temporaryHome() }), {
        name: "Test", platform: "linux", ...clock(), show: () => {},
        chooseDevice: async devices => { expect(devices[0]?.id).toBe("old"); return chosen },
      })
      if (chosen === null) await expect(result).rejects.toThrow()
      else await result
      expect(calls).toEqual([
        "POST /v1/device/code", "POST /v1/device/token", "GET /v1/devices",
        ...(chosen === null ? [] : ["DELETE /v1/devices/old", "POST /v1/device/token"]),
      ])
    })
  }

  test.each([undefined, {}, { ...limitDetail, limit: "bad" }, { ...limitDetail, reason: "billing_closed" }])(
    "invalid entitlement detail never offers revoke (%j)", async detail => {
      let offers = 0
      const api = fakeApi(request => request.url.endsWith("/code") ? Response.json(minted) : refusal("entitlement_required", detail, 403))
      await expect(loginDevice(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
        name: "Test", platform: "linux", ...clock(), show: () => {}, chooseDevice: async () => { offers++; return "old" },
      })).rejects.toThrow()
      expect(offers).toBe(0)
    },
  )
})
