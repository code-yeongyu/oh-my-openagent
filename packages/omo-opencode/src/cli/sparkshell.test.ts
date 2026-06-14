import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import {
  parseSparkShellFallbackInvocation,
  parseTopLevelSparkShellBudget,
  resolveFallbackShellArgv,
  runSparkShell,
  SPARKSHELL_USAGE,
  type SparkShellSpawnResult,
} from "./sparkshell"
import type { SparkSummaryRequest } from "./sparkshell-spark"

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

  test("#given top-level --budget #when reading the budget #then returns the clamped value only for Sparkshell-owned flags", () => {
    expect(parseTopLevelSparkShellBudget(["--budget", "5000", "git", "status"])).toBe(5000)
    expect(parseTopLevelSparkShellBudget(["--json", "--budget=9000", "git", "status"])).toBe(9000)
    expect(parseTopLevelSparkShellBudget(["git", "status", "--budget", "5000"])).toBeNull()
    expect(parseTopLevelSparkShellBudget(["--", "--budget", "5000"])).toBeNull()
    expect(parseTopLevelSparkShellBudget(["--budget", "junk", "git"])).toBeNull()
    expect(parseTopLevelSparkShellBudget(["--budget", "10", "git"])).toBe(2000)
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
        return { block: "===== codex session context =====", firstUserRequest: "", latestUserRequest: "" }
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
        return { block: "===== codex session context =====", firstUserRequest: "", latestUserRequest: "" }
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
        return { block: "===== codex session context =====", firstUserRequest: "", latestUserRequest: "" }
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

  test("#given the default spawn #when a real command runs #then its output is captured through writeStdout", async () => {
    // given
    const stdout: string[] = []

    // when
    const exitCode = await runSparkShell(["printf", "captured-via-pipe"], {
      env: {},
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
    })

    // then
    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("captured-via-pipe")
  })

  test("#given oversized output and a session goal #when a command runs #then condenses within the budget keeping goal lines", async () => {
    // given
    const stdout: string[] = []
    const hugeLog = `${Array.from({ length: 2000 }, (_, index) =>
      index === 1000 ? "applying fable-fallback.ts migration step" : `worker ${index} idle and waiting for jobs`,
    ).join("\n")}\n`

    // when
    const exitCode = await runSparkShell(["--budget", "5000", "cat", "huge.log"], {
      env: { CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e" },
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: hugeLog }),
      loadSessionContext: () => ({
        block: "CTX-BLOCK",
        firstUserRequest: "fix the `fable-fallback.ts` regression",
        latestUserRequest: "ship fable-fallback.ts after green tests",
      }),
      sparkSummarize: null,
    })

    // then
    const combined = stdout.join("")
    const commandOutput = combined.slice(0, combined.indexOf("CTX-BLOCK"))
    expect(exitCode).toBe(0)
    expect(combined).toContain("[sparkshell] condensed:")
    expect(combined).toContain("applying fable-fallback.ts migration step")
    expect(combined).toContain("CTX-BLOCK")
    expect(commandOutput.length).toBeLessThanOrEqual(5200)
    expect(combined.indexOf("[sparkshell] condensed:")).toBeLessThan(combined.indexOf("CTX-BLOCK"))
  })

  test("#given the condense kill switch #when oversized output flows #then passes it through raw", async () => {
    // given
    const stdout: string[] = []
    const hugeLog = `${"x".repeat(30_000)}\n`

    // when
    const exitCode = await runSparkShell(["cat", "huge.log"], {
      env: { CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e", OMO_SPARKSHELL_CONDENSE: "0" },
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: hugeLog }),
      loadSessionContext: () => ({ block: "CTX-BLOCK", firstUserRequest: "", latestUserRequest: "" }),
    })

    // then
    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain(hugeLog)
    expect(stdout.join("")).not.toContain("[sparkshell] condensed:")
  })

  test("#given the top-level --json flag #when oversized output flows #then never condenses", async () => {
    // given
    const stdout: string[] = []
    const hugeJson = `{"items":[${"1,".repeat(20_000)}1]}`

    // when
    const exitCode = await runSparkShell(["--json", "cat", "huge.json"], {
      env: { CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e" },
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: hugeJson }),
      loadSessionContext: () => ({ block: "CTX-BLOCK", firstUserRequest: "", latestUserRequest: "" }),
    })

    // then
    expect(exitCode).toBe(0)
    expect(stdout.join("")).toBe(hugeJson)
  })

  test("#given the appserver path #when oversized output returns #then condenses it like the fallback path", async () => {
    // given
    const stdout: string[] = []
    const hugeLog = Array.from({ length: 2000 }, (_, index) => `request ${index} handled`).join("\n")

    // when
    const exitCode = await runSparkShell(["--budget", "4000", "cat", "huge.log"], {
      env: { CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e" },
      appServerClient: {
        getPlatform: async () => "darwin" as const,
        exec: async () => ({ exitCode: 0, stdout: hugeLog, stderr: "" }),
      },
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      loadSessionContext: () => null,
      sparkSummarize: null,
    })

    // then
    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("[sparkshell] condensed:")
    expect(stdout.join("").length).toBeLessThanOrEqual(4400)
  })

  test("#given a native sidecar #when oversized output returns #then leaves the sidecar output untouched", async () => {
    // given
    const stdout: string[] = []
    const hugeLog = `${"sidecar-owned ".repeat(3000)}\n`

    // when
    const exitCode = await runSparkShell(["git", "status"], {
      env: { OMO_SPARKSHELL_BIN: "/tmp/omo-sparkshell", CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e" },
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: hugeLog }),
      loadSessionContext: () => null,
    })

    // then
    expect(exitCode).toBe(0)
    expect(stdout.join("")).toBe(hugeLog)
  })

  test("#given an output overflowing the capture buffer #when the spawn reports ENOBUFS #then surfaces truncation instead of a launch failure", async () => {
    // given
    const stdout: string[] = []
    const stderr: string[] = []
    const overflowError = Object.assign(new Error("spawnSync /bin/cat ENOBUFS"), { code: "ENOBUFS" })

    // when
    const exitCode = await runSparkShell(["cat", "giant.bin"], {
      env: {},
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: (value: string) => {
        stderr.push(value)
      },
      spawn: (): SparkShellSpawnResult => ({ status: null, error: overflowError, stdout: "partial-output" }),
    })

    // then
    expect(exitCode).toBe(1)
    expect(stdout.join("")).toContain("partial-output")
    expect(stderr.join("")).toContain("capture limit")
    expect(stderr.join("")).not.toContain("failed to launch")
  })

  test("#given a metacharacter command without --shell #when the spawn reports ENOENT #then hints to re-run with --shell", async () => {
    // given
    const stderr: string[] = []
    const enoentError = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })

    // when
    const exitCode = await runSparkShell(["pwd && ls"], {
      env: {},
      appServerClient: null,
      commandExists: () => false,
      writeStdout: () => {},
      writeStderr: (value: string) => {
        stderr.push(value)
      },
      spawn: (): SparkShellSpawnResult => ({ status: null, error: enoentError }),
    })

    // then
    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("failed to launch")
    expect(stderr.join("")).toContain("--shell")
  })

  test("#given a plain missing command without metacharacters #when the spawn reports ENOENT #then does not hint --shell", async () => {
    // given
    const stderr: string[] = []
    const enoentError = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })

    // when
    const exitCode = await runSparkShell(["definitely-not-a-cmd"], {
      env: {},
      appServerClient: null,
      commandExists: () => false,
      writeStdout: () => {},
      writeStderr: (value: string) => {
        stderr.push(value)
      },
      spawn: (): SparkShellSpawnResult => ({ status: null, error: enoentError }),
    })

    // then
    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("failed to launch")
    expect(stderr.join("")).not.toContain("--shell")
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

  test("#given oversized output and a spark summarizer #when a command runs #then prints the spark summary with caption instead of raw output", async () => {
    // given
    const stdout: string[] = []
    const requests: SparkSummaryRequest[] = []
    const hugeLog = `${Array.from({ length: 2000 }, (_, index) => `worker ${index} idle and waiting for jobs`).join("\n")}\n`

    // when
    const exitCode = await runSparkShell(["--budget", "5000", "cat", "huge.log"], {
      env: { CODEX_THREAD_ID: "019eafa2-a15f-73e1-b622-f7e4038f818e" },
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: hugeLog }),
      loadSessionContext: () => ({
        block: "CTX-BLOCK",
        firstUserRequest: "fix the fable-fallback.ts regression",
        latestUserRequest: "ship fable-fallback.ts after green tests",
      }),
      sparkSummarize: (request: SparkSummaryRequest) => {
        requests.push(request)
        return "worker 0 idle and waiting for jobs\n[sparkshell caption] ran `cat huge.log`; kept 1 of 2000 idle lines as-is; dropped the rest"
      },
    })

    // then
    const combined = stdout.join("")
    expect(exitCode).toBe(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.commandLine).toBe("cat huge.log")
    expect(requests[0]?.budgetChars).toBe(5000)
    expect(requests[0]?.sessionContext).toContain("CTX-BLOCK")
    expect(requests[0]?.text).toBe(hugeLog)
    expect(combined).toContain("[sparkshell] spark summary")
    expect(combined).toContain("[sparkshell caption]")
    expect(combined).not.toContain("worker 1999 idle")
    expect(combined).toContain("CTX-BLOCK")
    expect(combined.indexOf("[sparkshell] spark summary")).toBeLessThan(combined.indexOf("CTX-BLOCK"))
  })

  test("#given a failing spark summarizer #when oversized output flows #then falls back to deterministic condensation", async () => {
    // given
    const stdout: string[] = []
    const hugeLog = `${Array.from({ length: 2000 }, (_, index) => `request ${index} handled`).join("\n")}\n`

    // when
    const exitCode = await runSparkShell(["--budget", "4000", "cat", "huge.log"], {
      env: {},
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: hugeLog }),
      loadSessionContext: () => null,
      sparkSummarize: () => null,
    })

    // then
    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("[sparkshell] condensed:")
    expect(stdout.join("")).not.toContain("[sparkshell] spark summary")
  })

  test("#given the spark kill switch #when oversized output flows #then never invokes the summarizer", async () => {
    // given
    const stdout: string[] = []
    let sparkCalls = 0
    const hugeLog = `${Array.from({ length: 2000 }, (_, index) => `request ${index} handled`).join("\n")}\n`

    // when
    const exitCode = await runSparkShell(["--budget", "4000", "cat", "huge.log"], {
      env: { OMO_SPARKSHELL_SPARK: "0" },
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: hugeLog }),
      loadSessionContext: () => null,
      sparkSummarize: () => {
        sparkCalls += 1
        return "SPARK-SUMMARY"
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(sparkCalls).toBe(0)
    expect(stdout.join("")).toContain("[sparkshell] condensed:")
  })

  test("#given the top-level --json flag #when oversized output flows #then never invokes spark", async () => {
    // given
    const stdout: string[] = []
    let sparkCalls = 0
    const hugeJson = `{"items":[${"1,".repeat(20_000)}1]}`

    // when
    const exitCode = await runSparkShell(["--json", "cat", "huge.json"], {
      env: {},
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: hugeJson }),
      loadSessionContext: () => null,
      sparkSummarize: () => {
        sparkCalls += 1
        return "SPARK-SUMMARY"
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(sparkCalls).toBe(0)
    expect(stdout.join("")).toBe(hugeJson)
  })

  test("#given output within the budget #when a command runs #then never invokes spark", async () => {
    // given
    const stdout: string[] = []
    let sparkCalls = 0

    // when
    const exitCode = await runSparkShell(["echo", "ok"], {
      env: {},
      appServerClient: null,
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      spawn: (): SparkShellSpawnResult => ({ status: 0, stdout: "ok\n" }),
      loadSessionContext: () => null,
      sparkSummarize: () => {
        sparkCalls += 1
        return "SPARK-SUMMARY"
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(sparkCalls).toBe(0)
    expect(stdout.join("")).toBe("ok\n")
  })

  test("#given the appserver path #when oversized output returns #then spark-summarizes it like the fallback path", async () => {
    // given
    const stdout: string[] = []
    const hugeLog = Array.from({ length: 2000 }, (_, index) => `request ${index} handled`).join("\n")

    // when
    const exitCode = await runSparkShell(["--budget", "4000", "cat", "huge.log"], {
      env: {},
      appServerClient: {
        getPlatform: async () => "darwin" as const,
        exec: async () => ({ exitCode: 0, stdout: hugeLog, stderr: "" }),
      },
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      writeStderr: () => {},
      loadSessionContext: () => null,
      sparkSummarize: () => "APPSERVER-SPARK-SUMMARY\n[sparkshell caption] ran `cat huge.log`; trimmed idle lines",
    })

    // then
    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("APPSERVER-SPARK-SUMMARY")
    expect(stdout.join("")).not.toContain("request 1999 handled")
  })
})
