import { afterAll, beforeAll, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { lstat, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { buildServiceAuth } from "../../../../../script/build-service-auth"
import { credentialId } from "./keystore"
import { credentialSchema } from "./protocol"
import { fakeApi, grant, minted, temporaryHome } from "./test-support"

// #7185b: on a Linux machine with no Secret Service, `omo login` keeps the shared sign-in in the private state file, a
// second process uses the same device instead of registering a new one, and `omo logout` removes the file. The launcher
// loads a service-auth bundle built from THIS source into a temp copy of the launcher tree (the tracked bundle is
// regenerated only at the release-train top).
const root = resolve(import.meta.dir, "../../../../..")
const launcherTree = mkdtempSync(join(tmpdir(), "omo-state-file-launcher-"))
cpSync(join(root, "packages", "omo-native", "bin"), launcherTree, { recursive: true })
const launcher = join(launcherTree, "omo.js")
beforeAll(async () => {
  await buildServiceAuth(false, join(launcherTree, "lib", "service-auth.generated.js"))
}, 120_000)
afterAll(() => rmSync(launcherTree, { recursive: true, force: true }))

type Run = {
  readonly args: readonly string[]
  readonly code: number
  readonly keystoreCalls: boolean
  readonly stdout: string
}
type Observed = {
  readonly runs: readonly Run[]
  readonly fileModeAfterLogin: number
  readonly fileDeviceAfterLogin: string
  readonly fileAfterLogout: unknown
  readonly requests: readonly string[]
}

// The four launcher processes are the slow shared setup, so they run in this hook (a hook may take as long as the
// launcher needs on a loaded machine; a test may not raise its own timeout) and the test asserts what they observed.
let observed: Observed | undefined
beforeAll(async () => {
  if (process.platform !== "linux") return
  const home = await temporaryHome()
  const runtimeDir = join(home, "xdg-run")
  mkdirSync(runtimeDir, { recursive: true })
  const requests: string[] = []
  const api = fakeApi(async (request) => {
    const path = new URL(request.url).pathname
    requests.push(`${request.method} ${path}`)
    if (path === "/v1/health") return Response.json({ ok: true })
    if (path === "/v1/device/code")
      return Response.json({ ...minted, intervalSeconds: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() })
    if (path === "/v1/device/token") return Response.json(grant)
    if (path === "/v1/devices/device-1" && request.method === "DELETE") return new Response(null, { status: 204 })
    return new Response(null, { status: 404 })
  })
  const runs: Run[] = []
  const run = async (args: readonly string[]): Promise<string> => {
    const child = Bun.spawn(
      [process.execPath, "--preload", join(import.meta.dir, "state-file-cli.fixture.ts"), launcher, ...args],
      {
        cwd: home,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          USERPROFILE: home,
          XDG_RUNTIME_DIR: runtimeDir,
          OMO_RUNTIME: "bun",
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
          OMO_SERVICE_API_URL: api,
          // The child's own lock home: the test preload's account seam does not reach a child process (#12978).
          OMO_TEST_CREDENTIAL_LOCK_HOME: home,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      runs.push({ args, code, keystoreCalls: stderr.includes("KEYSTORE_CALL"), stdout })
      return stdout
    } finally {
      if (child.exitCode === null) child.kill()
      await child.exited
    }
  }
  const file = join(home, ".omo", "account-state", `omo-cli-${credentialId(api)}.json`)

  await run(["login", "--device", "--no-browser"])
  const fileModeAfterLogin = (await stat(file)).mode & 0o777
  const fileDeviceAfterLogin = credentialSchema.parse(JSON.parse(await readFile(file, "utf8"))).device.id
  await run(["whoami"])
  await run(["account", "show"])
  await run(["logout"])
  observed = {
    runs,
    fileModeAfterLogin,
    fileDeviceAfterLogin,
    fileAfterLogout: await lstat(file).catch(() => null),
    requests,
  }
}, 120_000)

test.skipIf(process.platform !== "linux")(
  "#given no Secret Service #when omo logs in, runs again and logs out #then one device lives in the 0600 file until logout",
  () => {
    if (observed === undefined) throw new Error("the launcher runs in beforeAll did not complete")
    const { runs, requests } = observed
    expect(runs.map(({ args, code, keystoreCalls }) => ({ args, code, keystoreCalls }))).toEqual(
      [["login", "--device", "--no-browser"], ["whoami"], ["account", "show"], ["logout"]].map((args) => ({
        args,
        code: 0,
        keystoreCalls: false,
      })),
    )
    const [login, whoami, show] = runs
    expect(login?.stdout).toContain(minted.userCode)
    expect(observed.fileModeAfterLogin).toBe(0o600)
    expect(observed.fileDeviceAfterLogin).toBe(grant.device.id)

    expect(whoami?.stdout).toContain(grant.device.name)
    expect(JSON.parse((show?.stdout ?? "").trim())).toMatchObject({
      signedIn: true,
      device: { id: grant.device.id },
      storage: "file",
    })
    expect(requests.filter((line) => line === "POST /v1/device/code")).toHaveLength(1)

    expect(observed.fileAfterLogout).toBeNull()
    expect(requests).toContain("DELETE /v1/devices/device-1")
  },
)
