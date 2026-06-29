import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"

const helperFilePath = fileURLToPath(new URL("./qa/web-terminal-visual-qa.mjs", import.meta.url))

const tempDirs: string[] = []

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "omo-web-terminal-command-qa-"))
  tempDirs.push(path)
  return path
}

function writeEmptyCaptureTmuxStub(fakeBin: string): void {
  const fakeTmuxPath = join(fakeBin, "tmux")
  mkdirSync(fakeBin)
  writeFileSync(
    fakeTmuxPath,
    [
      "#!/bin/sh",
      "case \"$1\" in",
      "  -V) printf 'tmux 3.4\\n'; exit 0 ;;",
      "  new-session) exit 0 ;;",
      "  capture-pane) exit 0 ;;",
      "  kill-session) exit 0 ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
    "utf8",
  )
  writeFileSync(
    join(fakeBin, "tmux.cmd"),
    ["@echo off", 'if "%1"=="-V" echo tmux 3.4', "exit /b 0", ""].join("\r\n"),
    "utf8",
  )
  if (process.platform !== "win32") chmodSync(fakeTmuxPath, 0o755)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("web terminal visual QA command mode", () => {
  test("#given command mode captures an empty tmux pane #when rendering #then the helper rejects the evidence", async () => {
    // given
    const dir = makeTempDir()
    const fakeBin = join(dir, "bin")
    writeEmptyCaptureTmuxStub(fakeBin)

    // when
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        helperFilePath,
        "--title",
        "Command QA",
        "--command",
        "printf visible",
        "--evidence-dir",
        dir,
        "--no-browser",
        "--dwell-ms",
        "1",
      ],
      env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH || ""}` },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdoutText, stderrText] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    // then
    expect(exitCode).toBe(1)
    expect(stderrText).toContain("tmux capture was empty")
    expect(stdoutText).toBe("")
  })
})
