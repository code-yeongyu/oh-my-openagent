/// <reference path="../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { resolveRunCommandInvocation } from "./codex-process"

describe("codex-process", () => {
  test("#given Windows npm command #when resolving run command invocation #then uses cmd shim", () => {
    // given
    const command = "npm"
    const args = ["install", "--omit=dev"] as const

    // when
    const invocation = resolveRunCommandInvocation(command, args, "win32")

    // then
    expect(invocation).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "install", "--omit=dev"],
    })
  })

  test("#given Windows codex command #when resolving run command invocation #then uses cmd shim", () => {
    // given
    const command = "codex"
    const args = ["exec", "doctor"] as const

    // when
    const invocation = resolveRunCommandInvocation(command, args, "win32")

    // then
    expect(invocation).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "codex.cmd", "exec", "doctor"],
    })
  })

  test("#given non-Windows npm command #when resolving run command invocation #then preserves direct execution", () => {
    // given
    const command = "npm"
    const args = ["install", "--omit=dev"] as const

    // when
    const invocation = resolveRunCommandInvocation(command, args, "linux")

    // then
    expect(invocation).toEqual({
      command: "npm",
      args: ["install", "--omit=dev"],
    })
  })

  test("#given Windows non-shim command #when resolving run command invocation #then preserves direct execution", () => {
    // given
    const command = "git"
    const args = ["status", "--short"] as const

    // when
    const invocation = resolveRunCommandInvocation(command, args, "win32")

    // then
    expect(invocation).toEqual({
      command: "git",
      args: ["status", "--short"],
    })
  })
})
