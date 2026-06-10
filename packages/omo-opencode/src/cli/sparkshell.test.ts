import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import {
  parseSparkShellFallbackInvocation,
  resolveFallbackShellArgv,
  runSparkShell,
  SPARKSHELL_USAGE,
  type SparkShellSpawnResult,
} from "./sparkshell"

function __repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("repo root sentinel not found")
    dir = parent
  }
}

const REPO_ROOT = __repoRootFrom(import.meta.dir)
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
    const commandChecks: string[] = []
    const stderr: string[] = []

    // when
    const exitCode = await runSparkShell(["git", "status"], {
      env: {},
      appServerClient: null,
      writeStderr: (value: string) => {
        stderr.push(value)
      },
      commandExists: (command: string) => {
        commandChecks.push(command)
        return false
      },
      spawn: (command: string, args: readonly string[]): SparkShellSpawnResult => {
        calls.push([command, ...args])
        return { status: 0 }
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(calls).toEqual([["git", "status"]])
    expect(commandChecks).toEqual([])
    expect(stderr.join("")).toBe("")
  })

  test("#given command-owned options #when native sidecar is absent #then preserves argv after the command boundary", async () => {
    // given
    const calls: string[][] = []

    // when
    const exitCode = await runSparkShell(["--json", "rg", "--json", "Sparkshell"], {
      env: {},
      appServerClient: null,
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
      appServerClient: null,
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
        cmd: ["bun", "packages/omo-opencode/src/cli/index.ts", "sparkshell", ...topLevelArgs, "printf", "%s", "--help"],
        cwd: REPO_ROOT,
        env: { ...process.env, CODEX_HOME: resolve(REPO_ROOT, ".not-codex-home-test") },
        stdout: "pipe",
        stderr: "pipe",
      })

      // then
      expect(result.exitCode).toBe(0)
      expect(textDecoder.decode(result.stdout)).toBe("--help")
      expect(textDecoder.decode(result.stderr)).toBe("")
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
    const invocation = parseSparkShellFallbackInvocation(args, {
      commandExists: (command: string) => command === "tmux",
    })

    // then
    expect(invocation).toEqual({
      kind: "tmux-pane",
      argv: ["tmux", "capture-pane", "-p", "-t", "%12", "-S", "-400"],
    })
  })

  test("#given win32 without tmux #when tmux pane mode runs #then fails before spawning a command", async () => {
    // given
    const calls: string[][] = []
    const stderr: string[] = []

    // when
    const exitCode = await runSparkShell(["--tmux-pane", "%12"], {
      env: {},
      appServerClient: null,
      platform: "win32",
      writeStderr: (value: string) => {
        stderr.push(value)
      },
      commandExists: (command: string) => command !== "tmux",
      spawn: (command: string, args: readonly string[]): SparkShellSpawnResult => {
        calls.push([command, ...args])
        return { status: 0 }
      },
    })

    // then
    expect(exitCode).toBe(1)
    expect(calls).toEqual([])
    expect(stderr.join("")).toContain("tmux is required for --tmux-pane mode")
  })

  test("#given a resolvable Codex session #when a command runs #then appends the session context after the shell result", async () => {
    // given
    const stdout: string[] = []
    const contextEnvs: Array<Readonly<Record<string, string | undefined>>> = []

    // when
    const exitCode = await runSparkShell(["git", "status"], {
      env: { CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e" },
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 3, stdout: "shell-output\n" }),
      loadSessionContext: (env) => {
        contextEnvs.push(env)
        return "===== codex session context ====="
      },
    })

    // then
    expect(exitCode).toBe(3)
    expect(stdout.join("")).toBe("shell-output\n\n===== codex session context =====\n")
    expect(contextEnvs).toEqual([{ CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e" }])
  })

  test("#given the top-level --json flag #when a command runs #then keeps output free of the session context", async () => {
    // given
    const stdout: string[] = []
    let contextLoads = 0

    // when
    const exitCode = await runSparkShell(["--json", "git", "status"], {
      env: { CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e" },
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: "{}" }),
      loadSessionContext: () => {
        contextLoads += 1
        return "===== codex session context ====="
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(stdout.join("")).toBe("{}")
    expect(contextLoads).toBe(0)
  })

  test("#given a parse failure #when nothing executes #then does not attach the session context", async () => {
    // given
    let contextLoads = 0

    // when
    const exitCode = await runSparkShell(["--shell"], {
      env: { CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e" },
      appServerClient: null,
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0 }),
      loadSessionContext: () => {
        contextLoads += 1
        return "===== codex session context ====="
      },
    })

    // then
    expect(exitCode).toBe(1)
    expect(contextLoads).toBe(0)
  })

  test("#given a session context loader that throws #when a command runs #then the shell exit code is preserved", async () => {
    // given
    const stdout: string[] = []

    // when
    const exitCode = await runSparkShell(["git", "status"], {
      env: { CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e" },
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: "ok\n" }),
      loadSessionContext: () => {
        throw new Error("rollout unavailable")
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(stdout.join("")).toBe("ok\n")
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
