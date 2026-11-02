import { expect, onTestFinished, spyOn, test } from "bun:test"
import { inspect } from "node:util"
import { ApiRefusal, jsonRequest, refusalGuidance, requestApi, serviceOrigin } from "./protocol"
import { createSession } from "./session"
import { fakeApi, grant, limitDetail, memorySecrets, minted, privateKeys, temporaryHome } from "./test-support"

const secrets = [grant.accessToken, grant.refreshToken, limitDetail.managementToken, minted.deviceCode]
for (const scenario of ["terminal", "network", "body", "management", "unknown-code"]) {
  test(`errors never expose credentials or raw response content for ${scenario}`, async () => {
    const payload = { error: {
      code: scenario === "terminal" ? "reauth_required" : scenario === "management" ? "entitlement_required" : secrets.join(":"),
      message: secrets.join(" "), retryable: false, requestId: "test", detail: limitDetail,
    } }
    const api = fakeApi(() => scenario === "body" ? new Response(secrets.join(" "))
      : Response.json(payload, { status: scenario === "management" ? 403 : 401 }))
    if (scenario === "network") {
      const fetcher = spyOn(globalThis, "fetch").mockRejectedValueOnce(Object.assign(new Error(secrets.join(" ")), { code: "ECONNREFUSED" }))
      onTestFinished(() => fetcher.mockRestore())
    }
    const store = memorySecrets().store(api)
    await store.write({ ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" })
    const action = scenario === "management" || scenario === "unknown-code"
      ? requestApi(api, "/v1/device/token", jsonRequest({ deviceCode: minted.deviceCode }))
      : createSession({ api, store, home: await temporaryHome() }).accessToken()
    const error: unknown = await action.catch(error => error)
    expect(error).toBeInstanceOf(Error)
    for (const secret of secrets) expect(`${String(error)} ${JSON.stringify(error)} ${inspect(error)}`).not.toContain(secret)
  })
}

for (const origin of ["http://example.com", "http://localhost:8080", "http://127.0.0.1", "http://[::1]:8080", "file:///tmp/test", "javascript:alert(1)"]) {
  test(`API override rejects insecure origin ${origin}`, () => {
    expect(() => createSession({ api: origin, store: memorySecrets().store("https://example.com") })).toThrow()
  })
}

// Contract: a refusal's guidance keys on the service code (then the status for an unknown code), so a
// rate limit or an outage is never reported as a sign-in problem (#11379).
test.each([
  ["unauthorized", 401, "sign_in_again"], ["reauth_required", 401, "sign_in_again"], ["invalid_grant", 400, "sign_in_again"],
  ["device_revoked", 401, "sign_in_again"], ["rate_limited", 429, "wait"], ["slow_down", 400, "wait"],
  ["internal", 500, "service_trouble"], ["unavailable", 503, "service_trouble"], ["invalid_request", 400, "update_omo"],
  ["not_found", 404, "update_omo"], ["account_deleted", 410, "account_deleted"], ["forbidden", 403, "account_refused"],
  ["entitlement_required", 403, "account_refused"], ["no_such_code", 401, "sign_in_again"], ["no_such_code", 429, "wait"],
  ["no_such_code", 502, "service_trouble"], ["no_such_code", 418, "account_refused"],
] as const)("a %s refusal with status %d is guided as %s", (code, status, guidance) => {
  const refusal = new ApiRefusal(code, status)
  expect(refusalGuidance(refusal.code, status)).toBe(guidance)
})

test("HTTPS origins and explicit IPv4 loopback test origins remain accepted", () => {
  expect(serviceOrigin("https://example.com")).toBe("https://example.com")
  expect(serviceOrigin("http://127.0.0.1:32145")).toBe("http://127.0.0.1:32145")
})
