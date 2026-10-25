import { expect, onTestFinished, spyOn, test } from "bun:test"
import { inspect } from "node:util"
import { jsonRequest, requestApi, serviceOrigin } from "./protocol"
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

test("HTTPS origins and explicit IPv4 loopback test origins remain accepted", () => {
  expect(serviceOrigin("https://example.com")).toBe("https://example.com")
  expect(serviceOrigin("http://127.0.0.1:32145")).toBe("http://127.0.0.1:32145")
})
