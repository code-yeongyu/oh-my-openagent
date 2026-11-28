import { describe, expect, test } from "bun:test"

import { buildChildArgs } from "./spawn"
import { PersonaTooLargeError, personaArgs } from "./persona-args"

const baseSpec = {
  task_id: "st_00000001",
  cwd: "/tmp/project",
  state_dir: "/tmp/project/.omo/senpi-task",
  prompt: "review",
}

describe("personaArgs", () => {
  test("#given a reviewer persona #when a process child is built #then its instructions, allowlist and denylist reach the senpi argv", () => {
    // when
    const args = buildChildArgs({
      ...baseSpec,
      instructions: "Role: code reviewer.",
      toolAllowlist: ["read", "grep", "bash"],
      toolDenylist: ["task"],
    })
    // then
    expect(args).toEqual([
      "--no-extensions",
      "--no-ask-user",
      "--append-system-prompt",
      "Role: code reviewer.",
      "--tools",
      "read,grep,bash",
      "--exclude-tools",
      "task",
    ])
  })

  test("#given no tool policy #when building #then no tool flag narrows the child", () => {
    expect(personaArgs({})).toEqual([])
  })

  test("#given an empty allowlist #when building #then the child gets no tools at all", () => {
    expect(personaArgs({ toolAllowlist: [] })).toEqual(["--no-tools"])
  })

  test("#given only denials #when building #then they apply without an allowlist", () => {
    expect(personaArgs({ toolDenylist: ["write", "edit"] })).toEqual(["--exclude-tools", "write,edit"])
  })

  test("#given a workpool worker with an allowlist #when building #then its yield tool stays allowed", () => {
    expect(personaArgs({ toolAllowlist: ["read"], memberScopedToolNames: ["workpool"] })).toEqual([
      "--tools",
      "read,workpool",
    ])
  })

  test("#given instructions over the argv budget #when building #then the launch is refused", () => {
    expect(() => personaArgs({ instructions: "x".repeat(100_001) }, "linux")).toThrow(PersonaTooLargeError)
  })

  // The POSIX per-argument limit is in bytes: 40k three-byte characters are 120 KB on the argv.
  test("#given multibyte instructions under the character count but over the byte budget #when building on POSIX #then the launch is refused", () => {
    expect(() => personaArgs({ instructions: "\u{AC00}".repeat(40_000) }, "linux")).toThrow(PersonaTooLargeError)
  })

  // win32 caps the whole command line at 32,767 UTF-16 units, far below the POSIX per-argument limit.
  test("#given instructions that fit POSIX but not the win32 command line #when building on win32 #then the launch is refused", () => {
    const instructions = "x".repeat(30_000)
    expect(personaArgs({ instructions }, "linux")).toContain(instructions)
    expect(() => personaArgs({ instructions }, "win32")).toThrow(PersonaTooLargeError)
  })
})
