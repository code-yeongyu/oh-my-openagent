import { expect, onTestFinished, test } from "bun:test"
import { withLock } from "@oh-my-opencode/team-core/team-state-store/locks"
import { mkdir, readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { systemPlatformFacts, userRecordHome } from "./account-home"
import { credentialId } from "./keystore"
import { credentialSchema, type Credentials } from "./protocol"
import { fakeApi, grant, privateKeys, temporaryHome } from "./test-support"

test("two processes share the refresh lock and never persist credentials in HOME or child arguments", async () => {
  const home = await temporaryHome()
  let saved: Credentials = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }
  let rotations = 0
  const api = fakeApi(async (request) => {
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
  await withLock(
    path,
    async () => {
      children.push(...[0, 1].map(() => Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" })))
    },
    { staleAfterMs: Number.POSITIVE_INFINITY },
  )
  const exits = await Promise.all(children.map((child) => child.exited))
  const errors = await Promise.all(
    children.map((child) => {
      if (!child.stderr || typeof child.stderr === "number") throw new Error("child stderr must be piped")
      return new Response(child.stderr).text()
    }),
  )
  expect(errors).toEqual(["", ""])
  expect(exits).toEqual([0, 0])
  expect(rotations).toBe(1)
  expect(saved.refreshToken).toBe("rotated-once")
  for (const name of await readdir(home, { recursive: true })) {
    const file = join(home, name)
    if (!(await stat(file)).isFile()) continue
    const text = await readFile(file, "utf8")
    for (const secret of [grant.accessToken, grant.refreshToken, ...Object.values(privateKeys)])
      expect(text).not.toContain(secret)
  }
}, 10_000)

// #12978: the credential item belongs to the OS user (Secret Service on the session bus, login Keychain, Credential
// Manager), not to $HOME. Two refreshers started with different HOME values must still share one lock, so the rotating
// refresh token reaches the service once. Each child is told the OS user record's home (a temp dir, so no test writes a
// lock outside its temp root). An authoritative read from a child that does not hold the account's lock is held until
// the other child reads too: without one shared lock both then refresh with the same token; with it, the second reads
// the successor.
test("two refreshers with different HOME values present one refresh token once (#12978)", async () => {
  const lockOwner = async (path: string): Promise<string | null> =>
    (await readFile(path, "utf8").catch(() => null))?.split("\n")[1] ?? null
  let saved: Credentials = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }
  const presented: string[] = []
  const unlocked: { pid: string; release: () => void }[] = []
  let lockPath = ""
  const api = fakeApi(async (request) => {
    if (request.url.endsWith("/fake-store")) {
      if (request.method === "PUT") saved = credentialSchema.parse(await request.json())
      const pid = request.headers.get("x-pid") ?? ""
      if (
        request.method === "GET" &&
        request.headers.get("x-read") === "authoritative" &&
        (await lockOwner(lockPath)) !== pid
      ) {
        const read = Promise.withResolvers<void>()
        unlocked.push({ pid, release: read.resolve })
        if (new Set(unlocked.map((entry) => entry.pid)).size === 2) for (const entry of unlocked) entry.release()
        await read.promise
      }
      return Response.json(saved)
    }
    presented.push(String(((await request.json()) as { refreshToken?: unknown }).refreshToken))
    return Response.json({ ...grant, refreshToken: "rotated-once" })
  })
  const account = await temporaryHome()
  lockPath = join(account, ".omo", "session-locks", `${credentialId(api)}.lock`)
  const homes = [await temporaryHome(), await temporaryHome()]
  const children = homes.map((home) =>
    Bun.spawn([process.execPath, join(import.meta.dir, "refresh-child.fixture.ts"), api, "", account], {
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home },
      stdout: "pipe",
      stderr: "pipe",
    }),
  )
  onTestFinished(async () => {
    for (const child of children) {
      if (child.exitCode === null) child.kill()
      await child.exited
    }
  })
  const exits = await Promise.all(children.map((child) => child.exited))
  const errors = await Promise.all(
    children.map((child) => {
      if (!child.stderr || typeof child.stderr === "number") throw new Error("child stderr must be piped")
      return new Response(child.stderr).text()
    }),
  )
  expect(errors).toEqual(["", ""])
  expect(exits).toEqual([0, 0])
  expect(presented).toEqual([grant.refreshToken])
  expect(saved.refreshToken).toBe("rotated-once")
}, 30_000)

// #12978: the real lookup on this platform (passwd, `id -P`, the registry profile of the SID) names the same home in a
// process started with a scratch HOME and USERPROFILE. It only resolves, so nothing is written.
test("the OS user record names one home whatever HOME a process starts with (#12978)", async () => {
  const scratch = await temporaryHome()
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "account-home.fixture.ts")], {
    env: { ...process.env, HOME: scratch, USERPROFILE: scratch },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exit, named] = await Promise.all([child.exited, new Response(child.stdout).text()])
  expect(exit).toBe(0)
  expect(named).not.toBe("")
  expect(named).not.toBe(scratch)
  expect(named).toBe(userRecordHome(systemPlatformFacts) ?? "")
}, 30_000)
