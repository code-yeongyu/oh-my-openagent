const { afterEach, beforeEach, describe, expect, test } = require("bun:test")
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"

const { executeHookCommand } = await import("./execute-hook-command")

function nodeCommand(script: string): string {
  return `"${process.execPath}" -e ${JSON.stringify(script)}`
}

describe("executeHookCommand", () => {
  let tempDirectory = ""

  beforeEach(() => {
    tempDirectory = mkdtempSync(join(tmpdir(), "omo-exec-hook-cmd-"))
  })

  afterEach(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })

  test("#given allowedEnvVars provided #when executing command #then only allowed vars are in process.env", async () => {
    // given
    process.env.__OMO_TEST_ALLOWED_VAR = "visible"
    process.env.__OMO_TEST_SECRET_VAR = "hidden"

    // when
    const result = await executeHookCommand(
      nodeCommand("console.log(process.env.__OMO_TEST_ALLOWED_VAR || '', process.env.__OMO_TEST_SECRET_VAR || '')"),
      "",
      tempDirectory,
      { allowedEnvVars: ["__OMO_TEST_ALLOWED_VAR"] },
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("visible")
    expect(result.stdout).not.toContain("hidden")

    // cleanup
    delete process.env.__OMO_TEST_ALLOWED_VAR
    delete process.env.__OMO_TEST_SECRET_VAR
  })

  test("#given no allowedEnvVars #when executing command #then full env is available", async () => {
    // given
    process.env.__OMO_TEST_FULL_ENV_VAR = "present"

    // when
    const result = await executeHookCommand(
      nodeCommand("console.log(process.env.__OMO_TEST_FULL_ENV_VAR || '')"),
      "",
      tempDirectory,
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("present")

    // cleanup
    delete process.env.__OMO_TEST_FULL_ENV_VAR
  })

  test("#given command ignores normal completion #when timeout expires #then returns timeout instead of hanging", async () => {
    // given
    const command = nodeCommand("setTimeout(() => {}, 1000)")

    // when
    const startedAt = Date.now()
    const result = await executeHookCommand(command, "", tempDirectory, {
      timeoutMs: 20,
      killGraceMs: 20,
    })

    // then
    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain("Hook command timed out after 20ms")
    expect(Date.now() - startedAt).toBeLessThan(1000)
  })

  test("#given pluginRoot option #when executing command #then CLAUDE_PLUGIN_ROOT env var is set", async () => {
    // when
    const result = await executeHookCommand(
      "echo $CLAUDE_PLUGIN_ROOT",
      "",
      tempDirectory,
      { pluginRoot: "/plugins/my-plugin" },
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("/plugins/my-plugin")
  })

  test("#given no pluginRoot option #when executing command #then CLAUDE_PLUGIN_ROOT is NOT set", async () => {
    const prev = process.env.CLAUDE_PLUGIN_ROOT
    delete process.env.CLAUDE_PLUGIN_ROOT

    // when
    const result = await executeHookCommand(
      "echo \"CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-unset}\"",
      "",
      tempDirectory,
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("unset")

    // cleanup
    if (prev !== undefined) process.env.CLAUDE_PLUGIN_ROOT = prev
  })

  test("#given pluginRoot with allowedEnvVars #when executing command #then CLAUDE_PLUGIN_ROOT is set and only allowed vars pass", async () => {
    // given
    process.env.__OMO_TEST_VISIBLE = "yes"
    process.env.__OMO_TEST_SECRET = "no"

    // when
    const result = await executeHookCommand(
      "echo \"$CLAUDE_PLUGIN_ROOT $__OMO_TEST_VISIBLE $__OMO_TEST_SECRET\"",
      "",
      tempDirectory,
      { pluginRoot: "/plugins/test", allowedEnvVars: ["__OMO_TEST_VISIBLE"] },
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("/plugins/test")
    expect(result.stdout).toContain("yes")
    expect(result.stdout).not.toContain("no")

    // cleanup
    delete process.env.__OMO_TEST_VISIBLE
    delete process.env.__OMO_TEST_SECRET
  })
})

export {}
