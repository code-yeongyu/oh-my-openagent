import { expect, test } from "bun:test"
import { openSignInBrowser } from "./browser"
import { Command } from "commander"
import { configureServiceAuthCommands } from "./commands"
import { serviceOrigin } from "./protocol"

test.each(["darwin", "win32", "linux"] as const)("browser child on %s receives no credentials in argv or environment", async platform => {
  const url = "https://accounts.omo.dev/?state=public-state&code_challenge=public-challenge"
  const childCalls: unknown[] = []
  await openSignInBrowser(url, async (file, args, env) => {
    childCalls.push({ file, args, env })
    expect(args).toContain(url)
    expect(env).toEqual({ PATH: "/bin", DISPLAY: ":0" })
    return true
  }, platform, { PATH: "/bin", DISPLAY: ":0", TOKEN: "synthetic-token", OMO_REFRESH_TOKEN: "synthetic-refresh" })
  expect(childCalls).toHaveLength(1)
  expect(JSON.stringify(childCalls)).not.toContain("synthetic-")
})

test("auth commands expose device, no-browser, and service overrides", () => {
  const program = new Command()
  configureServiceAuthCommands(program)
  expect(program.commands.map(command => command.name())).toEqual(["login", "logout", "whoami"])
  const login = program.commands.find(command => command.name() === "login")
  expect(login?.options.map(option => option.long)).toEqual(["--device", "--no-browser", "--api", "--accounts"])
})

test.each(["http://localhost:1234", "http://127.0.0.1", "https://user:secret@example.com", "https://api.omo.dev/path"])(
  "rejects unsafe service origin %s", origin => {
    expect(() => serviceOrigin(origin)).toThrow()
  },
)
