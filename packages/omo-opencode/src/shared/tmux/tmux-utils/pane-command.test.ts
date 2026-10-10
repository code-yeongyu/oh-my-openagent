import { describe, expect, it } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildTmuxAttachCommand, buildTmuxPlaceholderCommand } from "./pane-command"

const itWithUnixShell = it.skipIf(process.platform === "win32")

function createFakeOpencodeBin(tempDir: string): string {
  const binDir = join(tempDir, "bin")
  const opencodePath = join(binDir, "opencode")
  mkdirSync(binDir, { recursive: true })
  writeFileSync(
    opencodePath,
    [
      "#!/bin/sh",
      "index=0",
      "for arg in \"$@\"; do",
      "  printf '%s\\t%s\\n' \"$index\" \"$arg\"",
      "  index=$((index + 1))",
      "done",
    ].join("\n"),
  )
  chmodSync(opencodePath, 0o755)
  return binDir
}

function runCommandWithFakeOpencode(command: string, binDir: string): readonly string[] {
  const result = Bun.spawnSync(["/bin/sh", "-c", command], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
  })
  expect(result.exitCode).toBe(0)
  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .map((line) => line.split("\t").slice(1).join("\t"))
}

describe("buildTmuxAttachCommand", () => {
  it("uses /bin/sh instead of inheriting SHELL", () => {
    const originalShell = process.env.SHELL
    process.env.SHELL = "/bin/tcsh"

    try {
      const cmd = buildTmuxAttachCommand("http://localhost:3000", "ses_abc123")
      expect(cmd.startsWith('/bin/sh -c "')).toBe(true)
      expect(cmd).not.toContain("/bin/tcsh -c")
    } finally {
      process.env.SHELL = originalShell
    }
  })

  itWithUnixShell(
    "#given serverUrl shell metacharacters #when generated command runs through the shell #then serverUrl stays one literal argument",
    () => {
      const tempDir = mkdtempSync(join(tmpdir(), "omo tmux command "))

      try {
        const binDir = createFakeOpencodeBin(tempDir)
        const serverUrl = "http://localhost:3000$(whoami);rm -rf /"
        const cmd = buildTmuxAttachCommand(serverUrl, "ses_abc123")

        expect(runCommandWithFakeOpencode(cmd, binDir)).toEqual([
          "attach",
          serverUrl,
          "--session",
          "ses_abc123",
          "--dir",
          process.cwd(),
        ])
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    },
  )

  it("escapes session id shell metacharacters", () => {
    const cmd = buildTmuxAttachCommand("http://localhost:3000", 'ses_abc"$(whoami)"')
    expect(cmd).toContain('\\"')
    expect(cmd).toContain("\\$")
  })

  function createCountingOpencodeBin(tempDir: string, failTimes: number, finalExitCode = 0): string {
    const binDir = join(tempDir, "bin")
    const opencodePath = join(binDir, "opencode")
    mkdirSync(binDir, { recursive: true })
    writeFileSync(
      opencodePath,
      [
        "#!/bin/sh",
        'n=$(cat "$OMO_TEST_COUNT_FILE" 2>/dev/null || echo 0)',
        "n=$((n + 1))",
        'echo "$n" > "$OMO_TEST_COUNT_FILE"',
        'printf "%s\\n" "---invocation---" >> "$OMO_TEST_LOG_FILE"',
        'for arg in "$@"; do',
        '  printf "%s\\n" "$arg" >> "$OMO_TEST_LOG_FILE"',
        "done",
        `if [ "$n" -le ${failTimes} ]; then exit 1; fi`,
        `exit ${finalExitCode}`,
      ].join("\n"),
    )
    chmodSync(opencodePath, 0o755)
    return binDir
  }

  type RetryRunResult = {
    exitCode: number
    invocations: number
    lastInvocationArgs: readonly string[]
  }

  function runAttachCommandWithCountingBin(command: string, tempDir: string): RetryRunResult {
    const countFile = join(tempDir, "count")
    const logFile = join(tempDir, "invocations.log")
    const result = Bun.spawnSync(["/bin/sh", "-c", command], {
      env: {
        ...process.env,
        PATH: `${join(tempDir, "bin")}:${process.env.PATH ?? ""}`,
        OMO_TEST_COUNT_FILE: countFile,
        OMO_TEST_LOG_FILE: logFile,
      },
    })
    const log = readFileSync(logFile, "utf8")
    const blocks = log.split("---invocation---").slice(1).map((block) =>
      block.trim().split("\n").filter((line) => line.length > 0),
    )
    return {
      exitCode: result.exitCode,
      invocations: blocks.length,
      lastInvocationArgs: blocks[blocks.length - 1] ?? [],
    }
  }

  it("#given a generated attach command #when inspected as the tmux invocation payload #then attach runs in a survival retry loop instead of one-shot", () => {
    const cmd = buildTmuxAttachCommand("http://127.0.0.1:4096", "ses_abc123", "/tmp/proj")
    expect(cmd).toContain("while :; do")
    expect(cmd).toContain("opencode attach")
    // $code/$? are escaped for the outer double-quoted /bin/sh -c context.
    expect(cmd).toContain("code=\\$?")
    expect(cmd).toContain("case \\$code in 0|130|143) exit \\$code;; esac")
    expect(cmd).toContain("retrying in 2s")
    expect(cmd).toContain("sleep 2")
    expect(cmd).toContain("done")
  })

  itWithUnixShell(
    "#given opencode attach fails twice then succeeds #when the pane command runs #then it retries and finally invokes attach with the agent session args",
    () => {
      const tempDir = mkdtempSync(join(tmpdir(), "omo tmux retry "))
      try {
        const binDir = createCountingOpencodeBin(tempDir, 2)
        const cmd = buildTmuxAttachCommand("http://127.0.0.1:4096", "ses_retry1", "/tmp/proj")
        const result = runAttachCommandWithCountingBin(cmd, tempDir)

        expect(result.exitCode).toBe(0)
        expect(result.invocations).toBe(3)
        expect(result.lastInvocationArgs).toEqual([
          "attach",
          "http://127.0.0.1:4096",
          "--session",
          "ses_retry1",
          "--dir",
          "/tmp/proj",
        ])
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    },
  )

  itWithUnixShell(
    "#given the user quits attach with SIGINT exit code #when the pane command runs #then the loop exits with 130 without retrying",
    () => {
      const tempDir = mkdtempSync(join(tmpdir(), "omo tmux user-exit "))
      try {
        const binDir = createCountingOpencodeBin(tempDir, 0, 130)
        const cmd = buildTmuxAttachCommand("http://127.0.0.1:4096", "ses_quit", "/tmp/proj")
        const result = runAttachCommandWithCountingBin(cmd, tempDir)

        expect(result.exitCode).toBe(130)
        expect(result.invocations).toBe(1)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    },
  )
})

describe("buildTmuxPlaceholderCommand", () => {
  it("uses /bin/sh instead of inheriting SHELL", () => {
    const originalShell = process.env.SHELL
    process.env.SHELL = "/bin/csh"

    try {
      const cmd = buildTmuxPlaceholderCommand("My Task")
      expect(cmd.startsWith('/bin/sh -c "')).toBe(true)
      expect(cmd).not.toContain("/bin/csh -c")
    } finally {
      process.env.SHELL = originalShell
    }
  })

  it("produces inert placeholder command instead of immediate attach", () => {
    const cmd = buildTmuxPlaceholderCommand("My Task")
    expect(cmd).toContain("Focus this pane to attach.")
    expect(cmd).toContain("while :; do sleep 86400; done")
    expect(cmd).not.toContain("opencode attach")
  })

  it("keeps single quotes and percent signs inside safe printf arguments", () => {
    const cmd = buildTmuxPlaceholderCommand("Fix Bob's 100% broken pane")
    expect(cmd).toContain(`printf '%s\\n%s\\n'`)
    // Escaped quotes \" required for nested shell -c "..." argument
    expect(cmd).toContain(`\\"OMO subagent pane ready: Fix Bob's 100% broken pane\\"`)
  })
})
