import { expect, onTestFinished, test } from "bun:test"
import { join, resolve } from "node:path"
import { fakeApi, grant, limitDetail, minted, privateKeys, temporaryHome } from "./test-support"

for (const scenario of ["refusal", "unauthorized", "account_deleted", "invalid_grant", "network", "response-body", "device-limit", "device-name"]) {
  test(`native CLI error output hides every credential for ${scenario}`, async () => {
    const home = await temporaryHome()
    const secretValues = [grant.accessToken, grant.refreshToken, minted.deviceCode, limitDetail.managementToken]
    let stored: string | null = JSON.stringify({
      ...grant, ...privateKeys,
      ...(scenario === "device-name" ? { device: { id: grant.device.id, name: "\u001b[31mTest\u001b[0m\u0085\u200b CLI" } }
        : { accessTokenExpiresAt: "2000-01-01T00:00:00Z" }),
    })
    const api = fakeApi(async request => {
      const path = new URL(request.url).pathname
      if (path === "/fake-keystore") {
        if (request.method === "PUT") stored = await request.text()
        if (request.method === "DELETE") stored = null
        return Response.json(stored)
      }
      if (path === "/v1/device/code") return Response.json({
        ...minted, intervalSeconds: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      if (scenario === "response-body") return new Response(secretValues.join(" "))
      return Response.json({ error: {
        code: scenario === "device-limit" ? "entitlement_required"
          : ["unauthorized", "account_deleted", "invalid_grant"].includes(scenario) ? scenario : "reauth_required",
        message: secretValues.join(" "), retryable: false, requestId: "test", detail: limitDetail,
      } }, { status: scenario === "device-limit" ? 403 : scenario === "account_deleted" ? 410 : scenario === "invalid_grant" ? 400 : 401 })
    })
    const command = [
      process.execPath, "--preload", join(import.meta.dir, "cli-keystore.fixture.ts"),
      join(resolve(import.meta.dir, "../../../../.."), "packages", "omo-native", "bin", "omo.js"),
      ...(scenario === "device-limit" ? ["login", "--device"] : ["whoami"]),
    ]
    const env = {
      PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMO_RUNTIME: "bun",
      OMO_SERVICE_API_URL: api, OMO_TEST_KEYSTORE_URL: `${api}/fake-keystore`,
      OMO_TEST_FETCH_FAILURE: scenario === "network" ? "offline" : "",
    }
    const child = Bun.spawn(command, { cwd: home, env, stdout: "pipe", stderr: "pipe" })
    onTestFinished(async () => { if (child.exitCode === null) child.kill(); await child.exited })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect(code).toBe(scenario === "device-name" ? 0 : 1)
    if (scenario === "device-name") {
      expect(stdout).toContain("Test CLI")
      expect(stdout).not.toContain("\u001b")
      expect(stdout).not.toContain("\u200b")
      expect(stdout).not.toContain("\u0085")
      expect(stderr).toBe("")
    } else expect(stderr.length).toBeGreaterThan(0)
    for (const secret of secretValues) expect(JSON.stringify({ command, env, stdout, stderr })).not.toContain(secret)
  }, 15_000)
}
