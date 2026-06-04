import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

import {
  parseSparkShellFallbackInvocation,
  resolveFallbackShellArgv,
  runSparkShell,
  SPARKSHELL_USAGE,
  type SparkShellSpawnResult,
} from "./sparkshell"

const REPO_ROOT = resolve(import.meta.dir, "../..")
const textDecoder = new TextDecoder()

describe("sparkshell CLI", () => {
  test("#given no args #when running Sparkshell #then usage explains the command surface", async () => {
    // given
    const stderr: string[] = []

    // when
    const exitCode = await runSparkShell([], {
      writeStderr: (value: string) => {
        stderr.push(value)
      },
    })

    // then
    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("Usage: omo sparkshell <command> [args...]")
    expect(SPARKSHELL_USAGE).toContain("--tmux-pane")
  })

  test("#given direct argv #when native sidecar is absent #then falls back to raw command execution", async () => {
    // given
    const calls: string[][] = []

    // when
    const exitCode = await runSparkShell(["git", "status"], {
      env: {},
      writeStderr: () => {},
      spawn: (command: string, args: readonly string[]): SparkShellSpawnResult => {
        calls.push([command, ...args])
        return { status: 0 }
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(calls).toEqual([["git", "status"]])
  })

  test("#given command-owned options #when native sidecar is absent #then preserves argv after the command boundary", async () => {
    // given
    const calls: string[][] = []

    // when
    const exitCode = await runSparkShell(["--json", "rg", "--json", "Sparkshell"], {
      env: {},
      writeStderr: () => {},
      spawn: (command: string, args: readonly string[]): SparkShellSpawnResult => {
        calls.push([command, ...args])
        return { status: 0 }
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(calls).toEqual([["rg", "--json", "Sparkshell"]])
  })

  test("#given command-owned help flag #when native sidecar is absent #then does not show Sparkshell usage", async () => {
    // given
    const calls: string[][] = []
    const stdout: string[] = []

    // when
    const exitCode = await runSparkShell(["printf", "%s", "--help"], {
      env: {},
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (command: string, args: readonly string[]): SparkShellSpawnResult => {
        calls.push([command, ...args])
        return { status: 0 }
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(stdout.join("")).not.toContain("Usage: omo sparkshell")
    expect(calls).toEqual([["printf", "%s", "--help"]])
  })

  test("#given top-level Sparkshell options before command-owned help #when CLI runs #then Commander does not intercept help", () => {
    for (const topLevelArgs of [["--json"], ["--budget", "100"]]) {
      // when
      const result = Bun.spawnSync({
        cmd: ["bun", "src/cli/index.ts", "sparkshell", ...topLevelArgs, "printf", "%s", "--help"],
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      })

      // then
      expect(result.exitCode).toBe(0)
      expect(textDecoder.decode(result.stdout)).toBe("--help")
      expect(textDecoder.decode(result.stderr)).toContain("native sidecar unavailable")
    }
  })

  test("#given command-owned tmux flag #when parsing fallback invocation #then preserves it as raw argv", () => {
    // given
    const args = ["printf", "%s", "--tmux-pane"]

    // when
    const invocation = parseSparkShellFallbackInvocation(args)

    // then
    expect(invocation).toEqual({
      kind: "command",
      argv: ["printf", "%s", "--tmux-pane"],
    })
  })

  test("#given explicit shell script #when resolving fallback argv #then uses platform shell", () => {
    // given
    const script = "printf '%s' hello && printf '%s' world"

    // when
    const argv = resolveFallbackShellArgv(script, { platform: "linux" })

    // then
    expect(argv).toEqual(["sh", "-lc", script])
  })

  test("#given tmux pane mode #when parsing fallback invocation #then builds capture-pane argv with tail lines", () => {
    // given
    const args = ["--tmux-pane", "%12", "--tail-lines", "400"]

    // when
    const invocation = parseSparkShellFallbackInvocation(args)

    // then
    expect(invocation).toEqual({
      kind: "tmux-pane",
      argv: ["tmux", "capture-pane", "-p", "-t", "%12", "-S", "-400"],
    })
  })

  test("#given native sidecar override #when running Sparkshell #then delegates original args to sidecar", async () => {
    // given
    const calls: string[][] = []

    // when
    const exitCode = await runSparkShell(["--json", "git", "status"], {
      env: { OMO_SPARKSHELL_BIN: "/tmp/omo-sparkshell" },
      spawn: (command: string, args: readonly string[]): SparkShellSpawnResult => {
        calls.push([command, ...args])
        return { status: 7 }
      },
    })

    // then
    expect(exitCode).toBe(7)
    expect(calls).toEqual([["/tmp/omo-sparkshell", "--json", "git", "status"]])
  })
})
