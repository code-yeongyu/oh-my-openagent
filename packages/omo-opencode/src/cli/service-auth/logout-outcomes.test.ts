import { expect, onTestFinished, spyOn, test } from "bun:test"
import { join, resolve } from "node:path"
import { credentialSchema, type Credentials } from "./protocol"
import { createSession } from "./session"
import { fakeApi, grant, memorySecrets, privateKeys, refusal, temporaryHome } from "./test-support"
import { tlsTestCertificate } from "./tls-test-certificate"

const expired = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }

async function logoutHarness(reply: () => Response | Promise<Response>, overrideApi?: string) {
  const home = await temporaryHome()
  let stored: string | null = JSON.stringify(expired)
  const writes: Credentials[] = []
  const calls: string[] = []
  const atRefresh: (Credentials | null)[] = []
  const atRevoke: (Credentials | null)[] = []
  const entered = Promise.withResolvers<Credentials | null>()
  const readStored = () => stored === null ? null : credentialSchema.parse(JSON.parse(stored))
  const api = fakeApi(async request => {
    const path = new URL(request.url).pathname
    if (path === "/fake-keystore") {
      if (request.method === "PUT") {
        stored = await request.text()
        writes.push(credentialSchema.parse(JSON.parse(stored)))
      }
      if (request.method === "DELETE") stored = null
      return Response.json(stored)
    }
    calls.push(`${request.method} ${path}`)
    if (path === "/v1/session/refresh") {
      atRefresh.push(readStored())
      entered.resolve(readStored())
      expect(await request.json()).toEqual({ refreshToken: grant.refreshToken })
      return reply()
    }
    atRevoke.push(readStored())
    return new Response(null, { status: 204 })
  })
  const children: ReturnType<typeof Bun.spawn>[] = []
  onTestFinished(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await child.exited
    }
  })
  function launch(action: "logout" | "whoami", failure = "") {
    const command = [
      process.execPath, "--preload", join(import.meta.dir, "cli-keystore.fixture.ts"),
      join(resolve(import.meta.dir, "../../../../.."), "packages", "omo-native", "bin", "omo.js"), action,
    ]
    const env = {
      PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMO_RUNTIME: "bun",
      OMO_SERVICE_API_URL: overrideApi ?? api, OMO_TEST_KEYSTORE_URL: `${api}/fake-keystore`,
      OMO_TEST_FETCH_FAILURE: failure,
    }
    const child = Bun.spawn(command, { cwd: home, env, stdout: "pipe", stderr: "pipe" })
    children.push(child)
    const result = Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]).then(([stdout, stderr, code]) => {
      for (const secret of [grant.accessToken, grant.refreshToken, ...Object.values(privateKeys)]) {
        expect(JSON.stringify({ command, env, stdout, stderr })).not.toContain(secret)
      }
      return { stdout, stderr, code }
    })
    return { child, result }
  }
  return { launch, readStored, entered: entered.promise, writes, calls, atRefresh, atRevoke }
}

test("native logout journals before refresh and persists rotated credentials before revoke", async () => {
  const h = await logoutHarness(() => Response.json({ ...grant, accessToken: "rotated-access", refreshToken: "rotated-refresh" }))
  const result = await h.launch("logout").result
  expect(result.code).toBe(0)
  expect(result.stdout.length).toBeGreaterThan(0)
  expect(result.stderr).toBe("")
  expect(h.atRefresh).toEqual([{ ...expired, refreshState: "uncertain" }])
  expect(h.atRevoke[0]).toMatchObject({ accessToken: "rotated-access", refreshToken: "rotated-refresh" })
  expect(h.atRevoke[0]).not.toHaveProperty("refreshState")
  expect(h.calls).toEqual(["POST /v1/session/refresh", "DELETE /v1/devices/device-1"])
  expect(h.readStored()).toBeNull()
}, 15_000)

test("logout waits for journal persistence acknowledgment before dispatching refresh", async () => {
  const entered = Promise.withResolvers<void>()
  const permit = Promise.withResolvers<void>()
  const api = fakeApi(request => request.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json(grant))
  const base = memorySecrets().store(api)
  await base.write(expired)
  const store = { ...base, write: async (value: Credentials) => {
    if (value.refreshState === "uncertain") {
      entered.resolve()
      await permit.promise
    }
    await base.write(value)
  } }
  const original = globalThis.fetch
  let dispatched = 0
  const fetcher = spyOn(globalThis, "fetch").mockImplementation(Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      dispatched++
      return original(input, init)
    }, { preconnect: original.preconnect }))
  const logout = createSession({ api, store, home: await temporaryHome() }).logout()
  onTestFinished(async () => { permit.resolve(); await logout; fetcher.mockRestore() })
  await Promise.race([entered.promise, logout.then(() => { throw new Error("logout skipped its journal") })])
  expect(dispatched).toBe(0)
  expect(await base.read()).toEqual(expired)
  permit.resolve()
  expect(await logout).toBe(true)
  expect(dispatched).toBe(2)
  expect(await base.read()).toBeNull()
})

for (const outcome of ["500", "500-terminal", "lost-response", "timeout", "network", "tls",
  "unauthorized", "account_deleted", "reauth_required", "invalid_grant"]) {
  test(`native logout refresh ${outcome} fully clears with the correct warning and successful exit`, async () => {
    const terminal = ["unauthorized", "account_deleted", "reauth_required", "invalid_grant"].includes(outcome)
    let tlsRequests = 0
    const tlsServer = outcome === "tls" ? Bun.serve({
      hostname: "127.0.0.1", port: 0, tls: tlsTestCertificate(),
      fetch() { tlsRequests++; return Response.json(grant) },
    }) : null
    if (tlsServer) onTestFinished(() => tlsServer.stop(true))
    const h = await logoutHarness(() => {
      if (outcome === "500" || outcome === "500-terminal") return refusal(outcome === "500" ? "internal" : "unauthorized", undefined, 500)
      if (terminal) return refusal(outcome, undefined, outcome === "account_deleted" ? 410 : outcome === "invalid_grant" ? 400 : 401)
      return Response.json({ ...grant, refreshToken: "rotated" })
    }, tlsServer?.url.origin)
    const fault = outcome === "network" ? "offline" : outcome === "lost-response" || outcome === "timeout" ? outcome : ""
    const result = await h.launch("logout", fault).result
    expect(result.code).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0)
    expect(h.writes[0]).toEqual({ ...expired, refreshState: "uncertain" })
    expect(h.readStored()).toBeNull()
    expect(h.calls).toEqual(outcome === "network" || outcome === "tls" ? [] : ["POST /v1/session/refresh"])
    expect(tlsRequests).toBe(0)
    const deviceRevokedByServer = outcome === "account_deleted" || outcome === "reauth_required"
    if (deviceRevokedByServer) expect(result.stderr).toBe("")
    else expect(result.stderr).toContain("could not be confirmed")
    const after = await h.launch("whoami").result
    expect(after.code).toBe(1)
    expect(after.stderr).toContain("Not signed in")
    expect(h.readStored()).toBeNull()
    console.log(JSON.stringify({ outcome, exit: result.code, warning: result.stderr.trim(), cleared: true, whoami: after.stderr.trim() }))
  }, 15_000)
}

test("crashed logout refresh is cleared by a fresh logout without replay, then whoami is signed out", async () => {
  const held = Promise.withResolvers<Response>()
  onTestFinished(() => held.resolve(refusal("internal", undefined, 500)))
  const h = await logoutHarness(() => held.promise)
  const first = h.launch("logout")
  const journal = await Promise.race([
    h.entered,
    first.result.then(() => { throw new Error("logout exited before its refresh was observed") }),
  ])
  expect(journal).toEqual({ ...expired, refreshState: "uncertain" })
  // Only this owned PID is killed; the held response cannot complete beforehand.
  process.kill(first.child.pid, "SIGKILL")
  await first.result
  expect(h.readStored()).toEqual(journal)
  held.resolve(Response.json({ ...grant, refreshToken: "consumed" }))
  const recovered = await h.launch("logout").result
  expect(recovered.code).toBe(0)
  expect(recovered.stdout.length).toBeGreaterThan(0)
  expect(recovered.stderr.length).toBeGreaterThan(0)
  expect(h.readStored()).toBeNull()
  expect(h.calls).toEqual(["POST /v1/session/refresh"])
  const whoami = await h.launch("whoami").result
  expect(whoami.code).toBe(1)
  expect(whoami.stderr).toContain("Not signed in")
  expect(h.calls).toEqual(["POST /v1/session/refresh"])
  console.log(JSON.stringify({ outcome: "crash", exit: recovered.code, warning: recovered.stderr.trim(), cleared: true, refreshes: 1, whoami: whoami.stderr.trim() }))
}, 15_000)
