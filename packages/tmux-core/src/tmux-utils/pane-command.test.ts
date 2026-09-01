import { describe, expect, it } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

  itWithUnixShell(
    "#given directory path contains spaces #when generated command runs through the shell #then directory stays one argument",
    () => {
      const tempDir = mkdtempSync(join(tmpdir(), "omo tmux command "))
      const directory = join(tempDir, "Mobile Documents", "project")

      try {
        mkdirSync(directory, { recursive: true })
        const binDir = createFakeOpencodeBin(tempDir)

        const command = buildTmuxAttachCommand("http://localhost:3000", "ses_abc123", directory)

        expect(runCommandWithFakeOpencode(command, binDir)).toEqual([
          "attach",
          "http://localhost:3000",
          "--session",
          "ses_abc123",
          "--dir",
          directory,
        ])
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    },
  )
  it("places serverUrl before --session and --dir in output", () => {
    const serverUrl = "http://127.0.0.1:4242"
    const sessionId = "ses_abc123"
    const dir = "/tmp/test-project"
    const cmd = buildTmuxAttachCommand(serverUrl, sessionId, dir)
    // serverUrl must appear after "opencode attach" and before --session
    const attachIdx = cmd.indexOf("opencode attach")
    const urlIdx = cmd.indexOf(serverUrl)
    const sessionIdx = cmd.indexOf("--session")
    const dirIdx = cmd.indexOf("--dir")
    expect(attachIdx).toBeGreaterThanOrEqual(0)
    expect(urlIdx).toBeGreaterThan(attachIdx)
    expect(sessionIdx).toBeGreaterThan(urlIdx)
    expect(dirIdx).toBeGreaterThan(sessionIdx)
  })

  it("places sessionId after --session flag", () => {
    const cmd = buildTmuxAttachCommand("http://127.0.0.1:3000", "ses_target123", "/tmp/proj")
    const sessionFlagIdx = cmd.indexOf("--session")
    const sessionIdIdx = cmd.indexOf("ses_target123")
    expect(sessionFlagIdx).toBeGreaterThanOrEqual(0)
    expect(sessionIdIdx).toBeGreaterThan(sessionFlagIdx)
  })

  it("falls back to process.cwd() when directory argument is omitted", () => {
    const cwd = process.cwd()
    const cmd = buildTmuxAttachCommand("http://127.0.0.1:3000", "ses_abc123")
    // Nested /bin/sh quoting doubles Windows path separators.
    expect(cmd).toContain(cwd.replaceAll("\\", "\\\\"))
    expect(cmd).toContain("--dir")
  })
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
