import { expect, onTestFinished, test } from "bun:test"
import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fakeApi, grant, minted, temporaryHome } from "./test-support"
import { credentialSchema } from "./protocol"

test("real omo launcher signs in, reports status, and logs out without disk or output credentials", async () => {
  const home = await temporaryHome()
  let stored: string | null = null
  const requests: string[] = []
  const api = fakeApi(async request => {
    const path = new URL(request.url).pathname
    requests.push(`${request.method} ${path}`)
    if (path === "/fake-keystore") {
      if (request.method === "PUT") stored = await request.text()
      if (request.method === "DELETE") stored = null
      return Response.json(stored)
    }
    if (path === "/v1/device/code") return Response.json({
      ...minted, intervalSeconds: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    if (path === "/v1/device/token") return Response.json(grant)
    if (path === "/v1/devices/device-1" && request.method === "DELETE") return new Response(null, { status: 204 })
    return new Response(null, { status: 404 })
  })
  const root = resolve(import.meta.dir, "../../../../..")
  const children: ReturnType<typeof Bun.spawn>[] = []
  onTestFinished(async () => {
    for (const child of children) {
      if (child.exitCode === null) child.kill()
      await child.exited
    }
  })
  async function run(args: string[]) {
    const command = [
      process.execPath, "--preload", join(import.meta.dir, "cli-keystore.fixture.ts"),
      join(root, "packages/omo-native/bin/omo.js"), ...args,
    ]
    const env = {
      PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMO_RUNTIME: "bun",
      OMO_SERVICE_API_URL: api, OMO_TEST_KEYSTORE_URL: `${api}/fake-keystore`,
    }
    const child = Bun.spawn(command, { cwd: home, env, stdout: "pipe", stderr: "pipe" })
    children.push(child)
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect(stderr).toBe("")
    expect(code).toBe(0)
    for (const secret of [grant.accessToken, grant.refreshToken, minted.deviceCode]) {
      expect(JSON.stringify({ command, env, stdout, stderr })).not.toContain(secret)
    }
    return stdout
  }
  const output = await run(["login", "--device", "--no-browser"])
  expect(output).toContain(minted.verificationUri)
  expect(output).toContain(minted.userCode)
  expect(output).toContain(minted.matchingCode)
  expect(stored).not.toBeNull()
  const signedIn = credentialSchema.parse(JSON.parse(stored ?? "{}"))
  expect(await run(["whoami"])).toContain(grant.device.name)
  await run(["logout"])
  expect(stored).toBeNull()
  expect(requests.filter(path => path.startsWith("POST"))).toEqual(["POST /v1/device/code", "POST /v1/device/token"])
  for (const name of await readdir(home, { recursive: true })) {
    const file = join(home, name)
    if (!(await stat(file)).isFile()) continue
    const contents = await readFile(file, "utf8")
    expect(contents).not.toContain(grant.accessToken)
    expect(contents).not.toContain(grant.refreshToken)
    expect(contents).not.toContain(signedIn.signingPrivateKey)
    expect(contents).not.toContain(signedIn.sealingPrivateKey)
  }
}, 15_000)
