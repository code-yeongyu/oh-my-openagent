import { expect, onTestFinished, test } from "bun:test"
import { withLock } from "@oh-my-opencode/team-core/team-state-store/locks"
import { mkdir, readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { credentialId } from "./keystore"
import { credentialSchema, type Credentials } from "./protocol"
import { fakeApi, grant, privateKeys, temporaryHome } from "./test-support"

test("two processes share the refresh lock and never persist credentials in HOME or child arguments", async () => {
  const home = await temporaryHome()
  let saved: Credentials = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }
  let rotations = 0
  const api = fakeApi(async request => {
    if (request.url.endsWith("/fake-store")) {
      if (request.method === "PUT") saved = credentialSchema.parse(await request.json())
      return Response.json(saved)
    }
    rotations++
    expect(await request.json()).toEqual({ refreshToken: grant.refreshToken })
    return Response.json({ ...grant, refreshToken: "rotated-once" })
  })
  const directory = join(home, ".omo", "session-locks")
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${credentialId(api)}.lock`)
  const args = [process.execPath, join(import.meta.dir, "refresh-child.fixture.ts"), api, home]
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home }
  expect(JSON.stringify({ args, env })).not.toContain(grant.refreshToken)
  const children: ReturnType<typeof Bun.spawn>[] = []
  onTestFinished(async () => {
    for (const child of children) {
      if (child.exitCode === null) child.kill()
      await child.exited
    }
  })
  // Launch both contenders while the parent owns the same non-secret lock.
  await withLock(path, async () => {
    children.push(...[0, 1].map(() => Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" })))
  }, { staleAfterMs: Number.POSITIVE_INFINITY })
  const exits = await Promise.all(children.map(child => child.exited))
  const errors = await Promise.all(children.map(child => {
    if (!child.stderr || typeof child.stderr === "number") throw new Error("child stderr must be piped")
    return new Response(child.stderr).text()
  }))
  expect(errors).toEqual(["", ""])
  expect(exits).toEqual([0, 0])
  expect(rotations).toBe(1)
  expect(saved.refreshToken).toBe("rotated-once")
  for (const name of await readdir(home, { recursive: true })) {
    const file = join(home, name)
    if (!(await stat(file)).isFile()) continue
    const text = await readFile(file, "utf8")
    for (const secret of [grant.accessToken, grant.refreshToken, ...Object.values(privateKeys)]) expect(text).not.toContain(secret)
  }
}, 10_000)
