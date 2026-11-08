import { describe, expect, test } from "bun:test"
import type { Command } from "commander"
import { isClosedDeviceLogin, parsesAsClosedDeviceLogin } from "./closed-device-login"
import { serviceAuthProgram } from "./commands"

const STOP = new Error("stop before the login action runs")

// What the real closed root program decides for `argv`: the parse the login action would see, read in a preAction
// hook that then stops, so no device flow or network call ever runs.
function rootProgramRunsDeviceLogin(argv: readonly string[]): boolean {
  const program = serviceAuthProgram(false)
  // Subcommands copy these settings when they are created, so each one needs them too.
  for (const command of [program, ...program.commands]) command.exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} })
  let decided = false
  program.hook("preAction", (_root: Command, action: Command) => {
    decided = action.name() === "login" && isClosedDeviceLogin(action.opts(), action.args)
    throw STOP
  })
  try {
    program.parse([...argv], { from: "user" })
  } catch (error) {
    if (error !== STOP && !(error instanceof Error && "code" in error)) throw error
  }
  return decided
}

// #12723 review: the compiled entry's static refusal (compile-args.ts) parses a standalone `login` command, while the
// service-auth bundle parses `login` under its root program. The two must agree for every closed `login` argv.
describe("closed device login: standalone parse vs the service-auth root program", () => {
  test.each([
    [["login", "--device"]],
    [["login", "--no-browser"]],
    [["login", "--device", "--no-browser"]],
    [["login", "--api", "https://api.example.test", "--device"]],
    [["login", "--device", "--api=https://api.example.test"]],
    [["login"]],
    [["login", "--accounts", "https://signin.example.test", "--device"]],
    [["login", "--device", "operand"]],
    [["login", "--", "--device"]],
    [["login", "--device", "--api"]],
    [["login", "--browser"]],
    [["login", "-h"]],
    [["login", "--device", "--help"]],
    [["login", "--version", "--device"]],
    [["login", "--platform", "opencode", "--device"]],
  ] as const)("#given closed accounts #when %j is parsed #then both decide the same", (argv) => {
    // when
    const standalone = parsesAsClosedDeviceLogin(argv)
    const root = rootProgramRunsDeviceLogin(argv)

    // then
    expect({ argv, standalone }).toEqual({ argv, standalone: root })
  })

  test("#given closed accounts #when the plain device logins are parsed #then the root program runs the device flow", () => {
    expect(rootProgramRunsDeviceLogin(["login", "--device"])).toBe(true)
    expect(rootProgramRunsDeviceLogin(["login", "--no-browser"])).toBe(true)
    expect(rootProgramRunsDeviceLogin(["login"])).toBe(false)
  })
})
