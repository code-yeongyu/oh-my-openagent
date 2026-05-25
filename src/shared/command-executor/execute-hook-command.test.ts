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
      "echo $__OMO_TEST_ALLOWED_VAR $__OMO_TEST_SECRET_VAR",
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
      "echo $__OMO_TEST_FULL_ENV_VAR",
      "",
      tempDirectory,
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("present")

    // cleanup
    delete process.env.__OMO_TEST_FULL_ENV_VAR
  })
})

export {}
