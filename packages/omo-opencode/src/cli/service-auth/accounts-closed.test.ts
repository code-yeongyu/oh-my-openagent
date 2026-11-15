import { afterAll, beforeAll, expect, onTestFinished, test } from "bun:test"
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Command } from "commander"
import { createMcpOAuthCommand } from "../mcp-oauth"
import { signInHint, signInRoute } from "./accounts-gate"
import { CLOSED_LOGIN_MESSAGE, configureServiceAuthCommands } from "./commands"
import { fakeApi, temporaryHome } from "./test-support"
import { buildServiceAuth } from "../../../../../script/build-service-auth"

const root = resolve(import.meta.dir, "../../../../..")
// C10 (#13265): the launcher entry runs against a service-auth bundle built from THIS source into a temp copy of the
// launcher tree. The tracked bin/lib/service-auth.generated.js is stale at this head (the train top regenerates it)
// and predates this change, so a pass through the temp copy proves the source-built bundle is what loaded. No env
// var or flag selects the bundle path: the copy puts the built file exactly where bin/omo.js imports it by relative path.
const sourceLauncherTree = mkdtempSync(join(tmpdir(), "omo-source-launcher-"))
cpSync(join(root, "packages", "omo-native", "bin"), sourceLauncherTree, { recursive: true })
const entries = {
  launcher: join(sourceLauncherTree, "omo.js"),
  compiled: join(root, "packages", "omo-native", "compile-entry.ts"),
  toolkit: join(root, "packages", "omo-opencode", "src", "cli", "index.ts"),
}
beforeAll(async () => {
  await buildServiceAuth(false, join(sourceLauncherTree, "lib", "service-auth.generated.js"))
}, 120_000)
afterAll(() => rmSync(sourceLauncherTree, { recursive: true, force: true }))
// #12639: only these closed login forms still refuse, and the refusal names the terminal route (#13265).
const refusedInvocations = [
  ["login", "--accounts", "https://example.invalid"],
  ["login", "--api", "https://example.invalid"],
]

async function run(
  entry: string,
  args: readonly string[],
  extraEnv: Record<string, string> = {},
  fixture = "accounts-closed.fixture.ts",
) {
  const home = await temporaryHome()
  // A3 (#13265) and the LEAD's isolation rule: the env below is built fresh, so the parent's session bus is not
  // inherited, and the runtime dir is the child's own. Running cases pass the fake-store preload, because the
  // default fixture refuses every store access and the attach step reads the store before anything else.
  const runtimeDir = join(home, "xdg-run")
  mkdirSync(runtimeDir, { recursive: true })
  let requests = 0
  const api = fakeApi(() => {
    requests += 1
    return Response.json({ ok: true })
  })
  const child = Bun.spawn([process.execPath, "--preload", join(import.meta.dir, fixture), entry, ...args], {
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
  })
  onTestFinished(async () => {
    if (child.exitCode === null) child.kill()
    await child.exited
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  // The copied launcher's runtime probe creates .local/.cache/xdg-run under the temp HOME; a credential file would
  // still surface here.
  const homeEntries = readdirSync(home).filter((name) => name !== ".local" && name !== ".cache" && name !== "xdg-run")
  return { stdout, stderr, code, requests, homeEntries }
}

for (const [name, entry] of Object.entries(entries)) {
  test.each(refusedInvocations.map((args) => [args.join(" "), args] as const))(
    `#given accounts are closed #when the ${name} runs omo %s #then it refuses with no request, keystore access or file`,
    async (_argv, args) => {
      const result = await run(entry, args)
      expect({
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr.trim(),
        requests: result.requests,
        homeEntries: result.homeEntries,
      }).toEqual({ code: 1, stdout: "", stderr: CLOSED_LOGIN_MESSAGE, requests: 0, homeEntries: [] })
    },
    60_000,
  )
}

// #13265: bare `omo login` reaches the device-code flow through the launcher and the toolkit CLI. The fake API
// answers the health probe and the mint with a shape the flow cannot parse, which proves the flow ran without
// asserting on a granting service here (closed-device-login.test.ts covers the granted flow). The compiled entry is
// proven at its own seam (trustLaunchKind tables + parity): its flow half needs the staged plugin payload.
for (const [name, entry] of Object.entries({ launcher: entries.launcher, toolkit: entries.toolkit })) {
  test(`#given accounts are closed #when the ${name} runs omo login #then it reaches the device-code flow`, async () => {
    const result = await run(entry, ["login"], {}, "closed-device-login.fixture.ts")
    expect(result.requests).toBeGreaterThan(0)
    expect(result.stderr).not.toContain(CLOSED_LOGIN_MESSAGE)
    expect(result.stderr).not.toContain("isn't available yet")
    expect(result.stderr).not.toContain("Cannot access Linux Secret Service")
  }, 60_000)
}

for (const [name, entry] of Object.entries({ launcher: entries.launcher, compiled: entries.compiled })) {
  test(`#given accounts are closed #when the ${name} runs omo login --help #then it describes the device-code route`, async () => {
    const result = await run(entry, ["login", "--help"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("--device")
    expect(result.stderr).not.toContain(CLOSED_LOGIN_MESSAGE)
  }, 60_000)
}

// C4: logout and whoami run while closed. On an empty store whoami says so with the hint; logout signs out (no
// device to revoke, so no request) and leaves the signed-out marker.
test("#given accounts are closed and no sign-in is stored #when the launcher runs omo whoami #then it says so with the hint", async () => {
  const result = await run(entries.launcher, ["whoami"], {}, "closed-device-login.fixture.ts")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("Not signed in.")
  expect(result.stderr).toContain("omo login")
  expect(result.requests).toBe(0)
  expect(result.stderr).not.toContain("Cannot access Linux Secret Service")
}, 60_000)

test("#given accounts are closed and no sign-in is stored #when the launcher runs omo logout #then it signs out with no request", async () => {
  const result = await run(entries.launcher, ["logout"], {}, "closed-device-login.fixture.ts")
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("Signed out of OmO.")
  expect(result.requests).toBe(0)
  expect(result.stderr).not.toContain("Cannot access Linux Secret Service")
}, 60_000)

// C4 grammar: logout and whoami take --api and refuse anything else with the route-naming refusal.
test("#given accounts are closed #when the launcher runs omo logout with a stray operand #then it refuses naming the route", async () => {
  const result = await run(entries.launcher, ["logout", "extra"])
  expect(result.code).toBe(1)
  expect(result.stderr.trim()).toBe(CLOSED_LOGIN_MESSAGE)
  expect(result.requests).toBe(0)
}, 60_000)

// Contract: every sign-in hint follows the same switch as the commands (#11379); while closed the hint names BOTH
// routes (C11), because omo login now runs.
test("#given accounts are closed #then sign-in hints name both routes, and omo login once accounts open", () => {
  expect(signInRoute()).toBe("desktop")
  expect(signInRoute(true)).toBe("cli")
  expect(signInHint("first")).toContain("omo login")
  expect(signInHint("again")).toContain("omo login")
})

test("#given accounts are closed #then the toolkit help lists no service account command", () => {
  const program = new Command("omo")
  configureServiceAuthCommands(program)
  program.addCommand(createMcpOAuthCommand())
  const help = program.helpInformation()
  for (const name of ["login", "logout", "whoami"]) expect(help).not.toMatch(new RegExp(`^\\s+${name}\\b`, "m"))
  expect(help).toMatch(/^\s+mcp\b/m)
})

test.each(["login", "logout", "whoami"])(
  "#given accounts are closed #when the toolkit CLI runs omo help %s #then it describes the closed command",
  async (name) => {
    const result = await run(entries.toolkit, ["help", name])
    expect(result.code).toBe(0)
    if (name === "login") expect(result.stdout).toContain("--device")
    if (name === "logout") expect(result.stdout).toContain("Sign out of OmO")
    if (name === "whoami") expect(result.stdout).toContain("Show the current OmO device sign-in")
    expect(result.stderr).not.toContain(CLOSED_LOGIN_MESSAGE)
    expect(result.requests).toBe(0)
  },
  60_000,
)

test("#given accounts are closed #then the engine-less help names no service account command", async () => {
  const result = await run(entries.compiled, ["--help"], { OMO_EXTRA_CA_CERTIFICATES: "junk" })
  expect(result.code).toBe(0)
  expect(result.stdout).toMatch(/^Usage: omo /)
  expect(result.stdout).not.toMatch(/\b(login|logout|whoami)\b/)
}, 60_000)

test("#given accounts are closed #then provider sign-in commands are still registered and visible", () => {
  const oauth = createMcpOAuthCommand().commands.find((command) => command.name() === "oauth")
  if (!oauth) throw new Error("mcp oauth command missing")
  const login = oauth.commands.find((command) => command.name() === "login")
  expect(login).toBeDefined()
  expect(oauth.helpInformation()).toMatch(/^\s+login\b/m)
})
