import { expect, onTestFinished, test } from "bun:test"
import { join, resolve } from "node:path"
import { fakeApi, minted, temporaryHome } from "./test-support"

const launcher = join(resolve(import.meta.dir, "../../../../.."), "packages", "omo-native", "bin", "omo.js")

async function closedOrigin(): Promise<string> {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) })
  const origin = server.url.origin
  await server.stop(true)
  return origin
}

async function omo(args: string[], api: string) {
  const home = await temporaryHome()
  const keystore = fakeApi(() => Response.json(null))
  const child = Bun.spawn(
    [process.execPath, "--preload", join(import.meta.dir, "cli-keystore.fixture.ts"), launcher, ...args],
    {
      cwd: home,
      env: {
        PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMO_RUNTIME: "bun",
        OMO_SERVICE_API_URL: api, OMO_SERVICE_ACCOUNTS_URL: api, OMO_TEST_KEYSTORE_URL: keystore,
      },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    },
  )
  onTestFinished(async () => { if (child.exitCode === null) child.kill(); await child.exited })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  return { stdout, stderr: stderr.trim(), code }
}

test("login against an unreachable service stops before any sign-in step and says it can't reach the service", async () => {
  const api = await closedOrigin()
  const result = await omo(["login"], api)
  expect(result.stderr).toBe(`Can't reach OmO accounts at ${api}. The service may not be available yet, or your network, proxy or certificate settings are blocking it.`)
  expect(result.stdout).toBe("")
  expect(result.code).toBe(1)
})

test("login against a service whose health check is refused stops before any sign-in step", async () => {
  const requests: string[] = []
  const api = fakeApi(request => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`)
    return Response.json({ error: { code: "unavailable", message: "maintenance", retryable: true, requestId: "test" } }, { status: 503 })
  })
  const result = await omo(["login"], api)
  expect(requests).toEqual(["GET /v1/health"])
  expect(result.stderr).toBe(`OmO accounts at ${api} aren't available right now. Try again later.`)
  expect(result.code).toBe(1)
})

test("login against a reachable service checks health first, then signs in as before", async () => {
  const requests: string[] = []
  const api = fakeApi(request => {
    const path = new URL(request.url).pathname
    requests.push(`${request.method} ${path}`)
    if (path === "/v1/health") return Response.json({ ok: true })
    if (path === "/v1/device/code") return Response.json({ ...minted, intervalSeconds: 1, expiresAt: new Date(Date.now() - 1000).toISOString() })
    return new Response(null, { status: 404 })
  })
  const result = await omo(["login", "--device"], api)
  expect(requests.slice(0, 2)).toEqual(["GET /v1/health", "POST /v1/device/code"])
  expect(result.stdout).toContain(minted.userCode)
})
