import { afterAll, beforeAll, expect, onTestFinished, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { trustLaunchKind } from "../../../../omo-native/compile-args"
import { fakeApi, grant, minted, temporaryHome } from "./test-support"
import { buildServiceAuth } from "../../../../../script/build-service-auth"

// #12639: while accounts are closed, the device-code sign-in (`login --device`, `login --no-browser`) is the one terminal
// sign-in a computer with no browser or desktop app has. The npm launcher (which dispatches through the committed
// service-auth bundle) runs the device flow end to end; the compiled entry hands it past its static refusal
// (trustLaunchKind), after which it re-runs the same command in a fresh process, so that half is proved at its own seam.
// Every other closed service-account argv keeps refusing (accounts-closed.test.ts).
const root = resolve(import.meta.dir, "../../../../..")
// C10 (#13265): every launcher run in this file loads a service-auth bundle built from THIS source into a temp copy
// of the launcher tree; the tracked bundle is stale at this head (train top regenerates it) and predates this change,
// so passes here prove the source-built bundle loaded. No env var or flag selects the bundle path.
const launcherTree = mkdtempSync(join(tmpdir(), "omo-source-launcher-"))
cpSync(join(root, "packages", "omo-native", "bin"), launcherTree, { recursive: true })
const launcher = join(launcherTree, "omo.js")
beforeAll(async () => {
  await buildServiceAuth(false, join(launcherTree, "lib", "service-auth.generated.js"))
}, 120_000)
afterAll(() => rmSync(launcherTree, { recursive: true, force: true }))
// #12639: `login --device` and `login --no-browser` run the device flow while closed. #13265: bare `login` joins
// them (and `login --`, which parses to the same options and leftover), so a computer with no desktop sign-in signs
// in from the terminal; the attach refusal (#13096) answers a machine that already has its sign-in.
const deviceLogins = [["login", "--device"], ["login", "--no-browser"], ["login"], ["login", "--"]] as const

async function run(entry: string, args: readonly string[], extraEnv: Record<string, string> = {}) {
  const home = await temporaryHome()
  // A3 (#13265) + the LEAD's isolation rule: fresh env (no inherited session bus), the child's own runtime dir.
  const runtimeDir = join(home, "xdg-run")
  mkdirSync(runtimeDir, { recursive: true })
  const paths: string[] = []
  const api = fakeApi((request) => {
    const path = new URL(request.url).pathname
    paths.push(path)
    if (path === "/v1/health") return Response.json({ ok: true })
    if (path === "/v1/device/code")
      return Response.json({ ...minted, expiresAt: new Date(Date.now() + 300_000).toISOString(), intervalSeconds: 1 })
    if (path === "/v1/device/token") {
      return Response.json(
        { error: { code: "access_denied", message: "denied", retryable: false, requestId: "r" } },
        { status: 400 },
      )
    }
    return new Response("", { status: 404 })
  })
  const child = Bun.spawn(
    [process.execPath, "--preload", join(import.meta.dir, "closed-device-login.fixture.ts"), entry, ...args],
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
        OMO_SERVICE_ACCOUNTS_URL: api,
        // The child's own lock home: the test preload's account seam does not reach a child process (#12978).
        OMO_TEST_CREDENTIAL_LOCK_HOME: home,
        ...extraEnv,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  onTestFinished(async () => {
    if (child.exitCode === null) child.kill()
    await child.exited
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code, paths }
}

{
  test.each(deviceLogins.map((args) => [args.join(" "), args] as const))(
    `#given accounts are closed #when the launcher runs omo %s #then it runs the device flow and stores nothing on a denial`,
    async (_argv, args) => {
      const result = await run(launcher, args)
      expect(result.stdout).toContain(`User code: ${minted.userCode}`)
      expect(result.stdout).toContain(`Matching code: ${minted.matchingCode}`)
      expect(result.paths).toContain("/v1/device/code")
      expect(result.paths).toContain("/v1/device/token")
      expect(result.stderr).not.toContain("This form of omo login isn't available")
      expect(result.stderr).not.toContain("KEYSTORE_WRITE")
      expect(result.code).toBe(1)
    },
    60_000,
  )
}

test("#given accounts are closed #then the terminal sign-in commands leave the static refusal", () => {
  expect(deviceLogins.map((args) => trustLaunchKind(args))).toEqual(Array(deviceLogins.length).fill("one-shot-network"))
  expect(trustLaunchKind(["logout"])).toBe("one-shot-network")
  expect(trustLaunchKind(["whoami"])).toBe("one-shot-network")
  expect(
    [
      ["login", ""],
      ["login", "--accounts", "https://example.invalid"],
      ["login", "--api", "https://example.invalid"],
      ["login", "--help"],
      ["login", "--new-device"],
    ].map((args) => trustLaunchKind(args)),
  ).toEqual(Array(5).fill("static"))
})

// #12646: the compiled entry classifies a closed `login` with the same option parse commands.ts runs, so an argv the
// command refuses is a static refusal at the entry as well, and an argv the command runs is not.
test.each([
  [["login", "--device"], "one-shot-network"],
  [["login", "--no-browser"], "one-shot-network"],
  [["login", "--api", "https://example.invalid", "--device"], "one-shot-network"],
  [["login", "--device", "--api", "https://example.invalid"], "one-shot-network"],
  [["login", "--", "--device"], "static"],
  [["login", "--accounts", "https://example.invalid", "--device"], "static"],
  [["login", "--accounts", "--device"], "static"],
  [["login", "extra", "--device"], "static"],
  [["login", "--api"], "static"],
  [["login"], "one-shot-network"],
  [["login", "--"], "one-shot-network"],
  [["login", ""], "static"],
  [["logout"], "one-shot-network"],
  [["whoami"], "one-shot-network"],
  [["login", "--help"], "static"],
] as const)("#given accounts are closed #when the compiled entry classifies omo %j #then it is %s", (args, kind) => {
  expect(trustLaunchKind(args)).toBe(kind)
})

// #13265: the machine-present case. A stored sign-in (the adopted credential a desktop app's sign-in leaves, C3) is
// refused before any request — the attach refusal's own text, not a route refusal (C10) — and nothing is stored.
test("#given accounts are closed and a sign-in is stored #when the launcher runs omo login #then it refuses before any request", async () => {
  const result = await run(launcher, ["login"], { OMO_TEST_STORE: "seed" })
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("already signed in")
  expect(result.stderr).toContain("Run omo logout first")
  expect(result.paths).toEqual([])
  expect(result.stderr).not.toContain("KEYSTORE_WRITE")
}, 60_000)

async function runLoginWithGrant(me: () => Response) {
  const home = await temporaryHome()
  const runtimeDir = join(home, "xdg-run")
  mkdirSync(runtimeDir, { recursive: true })
  const paths: string[] = []
  const api = fakeApi((request) => {
    const path = new URL(request.url).pathname
    paths.push(path)
    if (path === "/v1/health") return Response.json({ ok: true })
    if (path === "/v1/device/code")
      return Response.json({ ...minted, expiresAt: new Date(Date.now() + 300_000).toISOString(), intervalSeconds: 1 })
    if (path === "/v1/device/token") return Response.json(grant)
    if (path === "/v1/me") return me()
    return new Response("", { status: 404 })
  })
  const child = Bun.spawn(
    [process.execPath, "--preload", join(import.meta.dir, "closed-device-login.fixture.ts"), launcher, "login"],
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
        OMO_SERVICE_ACCOUNTS_URL: api,
        OMO_TEST_CREDENTIAL_LOCK_HOME: home,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  onTestFinished(async () => {
    if (child.exitCode === null) child.kill()
    await child.exited
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code, paths }
}

// C5: the success line names the account; when the account read fails it says so and points at omo whoami, exit 0.
test("#given accounts are closed #when a bare omo login is approved #then the success line names the account", async () => {
  const result = await runLoginWithGrant(() =>
    Response.json({ user: { email: "ykim@example.com" }, account: { id: "acc-1" } }),
  )
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("User code: ")
  expect(result.stdout).toContain("Signed in to OmO as ykim@example.com.")
}, 60_000)

test("#given the account read fails after the grant #then the success line says so and points at omo whoami", async () => {
  const result = await runLoginWithGrant(() => new Response("", { status: 500 }))
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("could not be read")
  expect(result.stdout).toContain("omo whoami")
}, 60_000)

// F3.3: a non-default API origin is printed before the codes, so a redirected sign-in is visible.
test("#given a non-default API origin #when the device codes print #then the origin is printed first", async () => {
  const result = await runLoginWithGrant(() => Response.json({ user: { email: "ykim@example.com" } }))
  expect(result.stdout.indexOf("OmO API:")).toBeGreaterThanOrEqual(0)
  expect(result.stdout.indexOf("OmO API:")).toBeLessThan(result.stdout.indexOf("User code:"))
}, 60_000)
