import { describe, expect, it } from "bun:test"
import { buildTmuxAttachCommand, buildTmuxPlaceholderCommand } from "./pane-command"

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

  it("escapes serverUrl shell metacharacters", () => {
    const cmd = buildTmuxAttachCommand("http://localhost:3000$(whoami);rm -rf /", "ses_abc123")
    expect(cmd).toContain("\\$")
    expect(cmd).toContain("\\;")
    expect(cmd).not.toMatch(/[^\\];\s*rm/)
  })

  it("escapes session id shell metacharacters", () => {
    const cmd = buildTmuxAttachCommand("http://localhost:3000", 'ses_abc"$(whoami)"')
    expect(cmd).toContain('\\"')
    expect(cmd).toContain("\\$")
  })
})

describe("buildTmuxPlaceholderCommand", () => {
  it("uses /bin/sh instead of inheriting SHELL", () => {
    const originalShell = process.env.SHELL
    process.env.SHELL = "/bin/csh"

    try {
      const cmd = buildTmuxPlaceholderCommand("My Task")
      expect(cmd.startsWith("/bin/sh -c '")).toBe(true)
      expect(cmd).not.toContain("/bin/csh -c")
    } finally {
      process.env.SHELL = originalShell
    }
  })

  it("produces inert placeholder command instead of immediate attach", () => {
    const cmd = buildTmuxPlaceholderCommand("My Task")
    expect(cmd).toContain("Attaching automatically when ready.")
    expect(cmd).toContain("tail -f /dev/null")
    expect(cmd).not.toContain("opencode attach")
  })

  it("passes the description as a shell argument so spaces and quotes do not break the placeholder", () => {
    const cmd = buildTmuxPlaceholderCommand("Fix Bob's 100% broken pane")
    expect(cmd).toContain('printf "%s\\n%s\\n" "$1"')
    expect(cmd).toContain("sh 'OMO subagent pane ready: Fix Bob'\\''s 100% broken pane'")
    expect(cmd).not.toContain('"OMO subagent pane ready:')
  })

  it("survives shell metacharacters in the description", async () => {
    const cmd = buildTmuxPlaceholderCommand('worker "$(whoami)"; echo nope')
    const proc = Bun.spawn(["/bin/sh", "-c", `timeout 0.2s ${cmd}`], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exitCode).toBe(124)
    expect(stdout).toContain('OMO subagent pane ready: worker "$(whoami)"; echo nope')
    expect(stdout).toContain("Attaching automatically when ready.")
    expect(stderr).toBe("")
  })
})
