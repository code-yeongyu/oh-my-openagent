import { expect, onTestFinished, test } from "bun:test"
import { join, resolve } from "node:path"
import messages from "./fixtures/refresh-writer-v1/messages.json"
import { fakeApi, grant, minted, temporaryHome } from "./test-support"

test("the rebuilt launcher signs in directly at floor 2 and settles revoke-pending through sealed custody", async () => {
  const home = await temporaryHome()
  const values = new Map<string, string>()
  const calls: string[] = []
  const owner = { accountId: "account-cli", deviceId: grant.device.id, familyId: "family-cli", generation: 1, ownerHandle: "handle-cli" }
  const issued = { ...grant, owner, writerFloor: 2, freshAuthorizationProof: "synthetic-fresh-proof" }
  const api = fakeApi(async request => {
    const path = new URL(request.url).pathname
    if (path === "/fake-keystore") {
      const namespace = request.headers.get("x-omo-test-secret-service") ?? "omo-cli"
      if (request.method === "PUT") values.set(namespace, await request.text())
      if (request.method === "DELETE") values.delete(namespace)
      return Response.json(values.get(namespace) ?? null)
    }
    calls.push(`${request.method} ${path}`)
    if (path === "/v1/health") return Response.json({ ok: true })
    if (path === "/v1/me") return Response.json({ account: { id: owner.accountId } })
    if (path === "/.well-known/omo-service") return Response.json({ capabilities: messages.capabilities })
    if (path === "/v1/device/code") return Response.json({
      ...minted, intervalSeconds: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    if (path === "/v1/device/token") {
      expect(request.headers.get("omo-refresh-writer-version")).toBe("2")
      return Response.json(issued)
    }
    if (path === "/v1/session/credential-adoptions") {
      const body = await request.json() as { adoptionId: string; action: string }
      expect(body).toMatchObject({
        freshAuthorizationProof: issued.freshAuthorizationProof, expectedActiveOwner: null,
        credential: { owner, writerFloor: 2, refreshToken: issued.refreshToken },
      })
      return Response.json({
        version: 1, outcome: "approved", adoptionId: body.adoptionId, action: body.action,
        owner, writerFloor: 2, expectedActiveOwner: null,
      })
    }
    if (path === `/v1/devices/${owner.deviceId}` && request.method === "DELETE") {
      expect(request.headers.get("authorization")).toBe(`Bearer ${issued.accessToken}`)
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 404 })
  })
  const children: ReturnType<typeof Bun.spawn>[] = []
  onTestFinished(async () => {
    for (const child of children) {
      if (child.exitCode === null) child.kill()
      await child.exited
    }
  })
  const run = async (args: string[], input?: unknown, entry = join(resolve(import.meta.dir, "../../../../.."), "packages/omo-native/bin/omo.js")) => {
    const child = Bun.spawn([
      process.execPath, "--preload", join(import.meta.dir, "cli-keystore.fixture.ts"),
      entry, ...args,
    ], {
      cwd: home, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMO_RUNTIME: "bun",
        OMO_SERVICE_API_URL: api, OMO_TEST_KEYSTORE_URL: `${api}/fake-keystore` },
      stdin: input === undefined ? "ignore" : new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe",
    })
    children.push(child)
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { stdout, stderr, code }
  }
  expect((await run(["login", "--device", "--no-browser"])).code).toBe(0)
  expect(values.has("omo-cli")).toBe(false)
  expect(values.get("omo-cli-v2")).not.toContain("freshAuthorizationProof")
  expect((await run(["whoami"])).code).toBe(0)
  const host = await run([], undefined, join(import.meta.dir, "account-source.fixture.ts"))
  expect(host.code).toBe(0)
  expect(JSON.parse(host.stdout)).toEqual({ accountId: owner.accountId, accessToken: issued.accessToken })
  const token = await run(["account", "token"])
  expect(token.code).toBe(0)
  expect(JSON.parse(token.stdout)).toEqual({
    accessToken: issued.accessToken, accessTokenExpiresAt: issued.accessTokenExpiresAt, device: issued.device, owner,
  })
  const request = { version: 2, revocationId: "revoke-cli", owner }
  const revoked = await run(["account", "revoke-pending"], request)
  expect({ code: revoked.code, out: JSON.parse(revoked.stdout) }).toEqual({
    code: 0, out: { revocation: { revocationId: "revoke-cli", state: "confirmed", owner } },
  })
  expect((await run(["account", "revoke-pending"], request)).stdout).toBe(revoked.stdout)
  expect((await run(["account", "token"])).code).toBe(4)
  expect((await run(["whoami"])).code).toBe(1)
  expect(values.get("omo-cli-revocations-v2")).not.toContain(issued.refreshToken)
  expect(values.get("omo-cli-revocations-v2")).not.toContain("PrivateKey")
  expect(calls.filter(call => call.startsWith("DELETE"))).toHaveLength(1)
  expect(calls.some(call => call.includes("writer-enrollment"))).toBe(false)
}, 20_000)
