/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { parseLazyCodexInstallCliArgs } from "./lazycodex-cli-args"
import { runDelegatedOmoCommand } from "./lazycodex-delegated-command"

describe("codex Windows installer paths", () => {
  test("#given Windows npx @version install path #when logging dry-run command #then repo root is quoted away from file mentions", async () => {
    // given
    const repoRoot = String.raw`C:\Users\cole\AppData\Local\npm-cache\_npx\lazycodex-ai@4.13.0\node_modules\lazycodex-ai`
    const parsed = parseLazyCodexInstallCliArgs(["--dry-run", "install", "--repo-root", repoRoot])
    if (parsed.kind !== "command") throw new Error("expected dry-run install to delegate")
    const logs: string[] = []

    // when
    await runDelegatedOmoCommand(parsed, {
      cwd: repoRoot,
      platform: "win32",
      log: (line) => logs.push(line),
      runCommand: async () => {
        throw new Error("dry-run must not execute install")
      },
    })

    // then
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain(`"--repo-root=${repoRoot}"`)
    expect(logs[0]).not.toMatch(/\s--repo-root=[^"\s]*@/)
    expect(logs[0]).not.toContain("'")
  })
})
