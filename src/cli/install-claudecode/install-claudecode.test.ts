/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runClaudeCodeInstaller } from "./install-claudecode"

describe("runClaudeCodeInstaller", () => {
  test("shells out to claude plugin marketplace add then plugin install", async () => {
    // given
    const calls: { command: string; args: readonly string[] }[] = []
    const runCommand = async (command: string, args: readonly string[]) => {
      calls.push({ command, args })
    }

    // when
    const result = await runClaudeCodeInstaller({ runCommand })

    // then
    expect(calls.length).toBe(2)
    expect(calls[0]?.command).toBe("claude")
    expect(calls[0]?.args).toEqual(["plugin", "marketplace", "add", "code-yeongyu/lazyclaudecode"])
    expect(calls[1]?.command).toBe("claude")
    expect(calls[1]?.args).toEqual(["plugin", "install", "omo@sisyphuslabs"])
    expect(result.marketplaceName).toBe("sisyphuslabs")
    expect(result.pluginRef).toBe("omo@sisyphuslabs")
  })

  test("prints the two /plugin commands and throws when claude is absent, writing nothing to ~/.claude", async () => {
    // given: an isolated HOME so we can assert ~/.claude is never written
    const fakeHome = await mkdtemp(join(tmpdir(), "omo-cc-home-"))
    // a PATH that contains no `claude` binary
    const emptyBinDir = await mkdtemp(join(tmpdir(), "omo-cc-emptybin-"))
    const printed: string[] = []
    const claudeHome = join(fakeHome, ".claude")

    // when / then
    let thrown: unknown
    try {
      await runClaudeCodeInstaller({
        homeDir: fakeHome,
        env: { PATH: emptyBinDir, HOME: fakeHome },
        log: (message) => printed.push(message),
      })
    } catch (error) {
      thrown = error
    }

    // then: it threw a clear error
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message.toLowerCase()).toContain("claude")

    // then: it printed BOTH /plugin commands for manual recovery
    const printedText = printed.join("\n")
    expect(printedText).toContain("/plugin marketplace add code-yeongyu/lazyclaudecode")
    expect(printedText).toContain("/plugin install omo@sisyphuslabs")

    // then: NOTHING was written to ~/.claude
    expect(existsSync(claudeHome)).toBe(false)
    const entries = await readdir(fakeHome)
    expect(entries).toEqual([])
  })

  test("prints the two /plugin commands and throws when claude exits non-zero, writing nothing to ~/.claude", async () => {
    // given
    const fakeHome = await mkdtemp(join(tmpdir(), "omo-cc-home-"))
    const printed: string[] = []
    const claudeHome = join(fakeHome, ".claude")
    const runCommand = async () => {
      throw new Error("claude plugin marketplace add code-yeongyu/lazyclaudecode failed with exit code 1")
    }

    // when / then
    let thrown: unknown
    try {
      await runClaudeCodeInstaller({
        homeDir: fakeHome,
        runCommand,
        log: (message) => printed.push(message),
      })
    } catch (error) {
      thrown = error
    }

    // then
    expect(thrown).toBeInstanceOf(Error)
    const printedText = printed.join("\n")
    expect(printedText).toContain("/plugin marketplace add code-yeongyu/lazyclaudecode")
    expect(printedText).toContain("/plugin install omo@sisyphuslabs")
    expect(existsSync(claudeHome)).toBe(false)
  })
})
