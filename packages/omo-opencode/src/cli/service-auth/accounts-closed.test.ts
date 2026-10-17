import { expect, onTestFinished, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { Command } from "commander"
import { createMcpOAuthCommand } from "../mcp-oauth"
import { configureServiceAuthCommands, SERVICE_ACCOUNTS_CLOSED_MESSAGE } from "./commands"
import { fakeApi, temporaryHome } from "./test-support"

const root = resolve(import.meta.dir, "../../../../..")
const entries = {
  launcher: join(root, "packages", "omo-native", "bin", "omo.js"),
  compiled: join(root, "packages", "omo-native", "compile-entry.ts"),
}
const invocations = [
  ["login"], ["login", "--device"], ["login", "--no-browser", "--api", "https://example.invalid"], ["login", "--help"],
  ["logout"], ["whoami"], ["whoami", "--help"],
]

async function run(entry: string, args: readonly string[], extraEnv: Record<string, string> = {}) {
  const home = await temporaryHome()
  let requests = 0
  const api = fakeApi(() => { requests += 1; return Response.json({ ok: true }) })
  const child = Bun.spawn(
    [process.execPath, "--preload", join(import.meta.dir, "accounts-closed.fixture.ts"), entry, ...args],
    {
      cwd: home,
      env: {
        PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMO_RUNTIME: "bun", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        OMO_SERVICE_API_URL: api, OMO_SERVICE_ACCOUNTS_URL: api, ...extraEnv,
      },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    },
  )
  onTestFinished(async () => { if (child.exitCode === null) child.kill(); await child.exited })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  return { stdout, stderr, code, requests, homeEntries: readdirSync(home) }
}

for (const [name, entry] of Object.entries(entries)) {
  test.each(invocations.map(args => [args.join(" "), args] as const))(
    `#given accounts are closed #when the ${name} runs omo %s #then it refuses with no request, keystore access or file`,
    async (_argv, args) => {
      const result = await run(entry, args)
      expect({
        code: result.code, stdout: result.stdout, stderr: result.stderr.trim(),
        requests: result.requests, homeEntries: result.homeEntries,
      }).toEqual({ code: 1, stdout: "", stderr: SERVICE_ACCOUNTS_CLOSED_MESSAGE, requests: 0, homeEntries: [] })
    },
    60_000,
  )
}

test("#given accounts are closed #then the toolkit help lists no service account command", () => {
  const program = new Command("omo")
  configureServiceAuthCommands(program)
  program.addCommand(createMcpOAuthCommand())
  const help = program.helpInformation()
  for (const name of ["login", "logout", "whoami"]) expect(help).not.toMatch(new RegExp(`^\\s+${name}\\b`, "m"))
  expect(help).toMatch(/^\s+mcp\b/m)
})

test.each(["login", "logout", "whoami"])("#given accounts are closed #when the toolkit CLI runs omo help %s #then it refuses instead of printing usage", async name => {
  const result = await run(join(root, "packages", "omo-opencode", "src", "cli", "index.ts"), ["help", name])
  expect({ code: result.code, stdout: result.stdout, stderr: result.stderr.trim(), requests: result.requests })
    .toEqual({ code: 1, stdout: "", stderr: SERVICE_ACCOUNTS_CLOSED_MESSAGE, requests: 0 })
}, 60_000)

test("#given accounts are closed #then the engine-less help names no service account command", async () => {
  const result = await run(entries.compiled, ["--help"], { OMO_EXTRA_CA_CERTIFICATES: "junk" })
  expect(result.code).toBe(0)
  expect(result.stdout).toMatch(/^Usage: omo /)
  expect(result.stdout).not.toMatch(/\b(login|logout|whoami)\b/)
}, 60_000)

test("#given accounts are closed #then provider sign-in commands are still registered and visible", () => {
  const oauth = createMcpOAuthCommand().commands.find(command => command.name() === "oauth")
  if (!oauth) throw new Error("mcp oauth command missing")
  const login = oauth.commands.find(command => command.name() === "login")
  expect(login).toBeDefined()
  expect(oauth.helpInformation()).toMatch(/^\s+login\b/m)
})
