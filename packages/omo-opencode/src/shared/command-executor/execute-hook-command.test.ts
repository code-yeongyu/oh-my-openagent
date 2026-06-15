const { afterEach, beforeEach, describe, expect, test } = require("bun:test")
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"

const { executeHookCommand } = await import("./execute-hook-command")
const timeoutAssertionMs = process.platform === "win32" ? 5_000 : 1_000

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
    expect(Date.now() - startedAt).toBeLessThan(timeoutAssertionMs)
  })

  // Regression coverage for #4458 - plugin-sourced hooks must run with
  // CLAUDE_PLUGIN_ROOT exported into the child env (so scripts can read
  // process.env.CLAUDE_PLUGIN_ROOT) AND substituted in the command string
  // (so commands written as `$CLAUDE_PLUGIN_ROOT/scripts/foo.sh` resolve).
  test("#given pluginRoot option #when executing command #then CLAUDE_PLUGIN_ROOT is exported into env", async () => {
    // when
    const result = await executeHookCommand(
      "echo plugin-root=$CLAUDE_PLUGIN_ROOT",
      "",
      tempDirectory,
      { pluginRoot: "/tmp/plugin-x" },
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("plugin-root=/tmp/plugin-x")
  })

  test("#given pluginRoot option with allowedEnvVars #when executing command #then CLAUDE_PLUGIN_ROOT survives the env scrub", async () => {
    // when
    const result = await executeHookCommand(
      "echo plugin-root=$CLAUDE_PLUGIN_ROOT",
      "",
      tempDirectory,
      { pluginRoot: "/tmp/plugin-y", allowedEnvVars: [] },
    )

    // then - the empty allowedEnvVars list scrubs everything except HOME/PATH,
    // but CLAUDE_PLUGIN_ROOT must still be present because pluginRoot is
    // honored independently of the allowlist.
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("plugin-root=/tmp/plugin-y")
  })

  test("#given pluginRoot option #when command references ${CLAUDE_PLUGIN_ROOT} #then it is substituted before spawn", async () => {
    // when - shell-style ${VAR} would normally also expand at spawn time, but
    // we substitute earlier so the form works even in commands that disable
    // shell variable expansion downstream.
    const result = await executeHookCommand(
      'echo "rooted=${CLAUDE_PLUGIN_ROOT}/scripts/foo.sh"',
      "",
      tempDirectory,
      { pluginRoot: "/tmp/plugin-z" },
    )

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("rooted=/tmp/plugin-z/scripts/foo.sh")
  })
})

export {}
