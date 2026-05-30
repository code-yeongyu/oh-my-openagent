const { afterEach, beforeEach, describe, expect, test } = require("bun:test")
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"

const { executeHookCommand } = await import("./execute-hook-command")

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
      "node -e \"console.log(process.env.__OMO_TEST_ALLOWED_VAR, process.env.__OMO_TEST_SECRET_VAR)\"",
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
      "node -e \"console.log(process.env.__OMO_TEST_FULL_ENV_VAR)\"",
      "",
      tempDirectory,
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("present")

    // cleanup
    delete process.env.__OMO_TEST_FULL_ENV_VAR
  })

  test("#given pluginRoot provided #when executing command #then CLAUDE_PLUGIN_ROOT is set in env", async () => {
    // given
    const pluginRoot = "/opt/my-plugin"

    // when
    const result = await executeHookCommand(
      "node -e \"console.log(process.env.CLAUDE_PLUGIN_ROOT)\"",
      "",
      tempDirectory,
      { pluginRoot },
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(pluginRoot)
  })

  test("#given pluginRoot provided with allowedEnvVars #when executing command #then CLAUDE_PLUGIN_ROOT is set alongside restricted env", async () => {
    // given
    const pluginRoot = "/opt/my-plugin"
    process.env.__OMO_TEST_ALLOWED_VAR2 = "allowed"
    process.env.__OMO_TEST_SECRET_VAR2 = "secret"

    // when
    const result = await executeHookCommand(
      "node -e \"console.log(process.env.CLAUDE_PLUGIN_ROOT, process.env.__OMO_TEST_ALLOWED_VAR2, process.env.__OMO_TEST_SECRET_VAR2)\"",
      "",
      tempDirectory,
      { pluginRoot, allowedEnvVars: ["__OMO_TEST_ALLOWED_VAR2"] },
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(pluginRoot)
    expect(result.stdout).toContain("allowed")
    expect(result.stdout).not.toContain("secret")

    // cleanup
    delete process.env.__OMO_TEST_ALLOWED_VAR2
    delete process.env.__OMO_TEST_SECRET_VAR2
  })
})

export {}
