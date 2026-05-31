import { describe, expect, it } from "bun:test"
import { buildTmuxAttachCommand, buildTmuxPlaceholderCommand } from "./pane-command"

describe("buildTmuxAttachCommand", () => {
  it("uses /bin/sh instead of inheriting SHELL", () => {
    const originalShell = process.env.SHELL
    process.env.SHELL = "/bin/tcsh"

    try {
      const cmd = buildTmuxAttachCommand("http://localhost:3000", "ses_abc123")
      expect(cmd.startsWith("/bin/sh -c '")).toBe(true)
      expect(cmd).not.toContain("/bin/tcsh -c")
    } finally {
      process.env.SHELL = originalShell
    }
  })

  it("escapes serverUrl shell metacharacters", () => {
    const cmd = buildTmuxAttachCommand("http://localhost:3000$(whoami);rm -rf /", "ses_abc123")
    expect(cmd).toContain("http://localhost:3000$(whoami);rm -rf /")
    expect(cmd).toContain("'\\''http://localhost:3000$(whoami);rm -rf /'\\''")
  })

  it("escapes session id shell metacharacters", () => {
    const cmd = buildTmuxAttachCommand("http://localhost:3000", 'ses_abc"$(whoami)"')
    expect(cmd).toContain("--session")
    expect(cmd).toContain(`'\\''ses_abc"$(whoami)"'\\''`)
  })

  it("uses an explicit opencode binary path when provided", () => {
    const originalBin = process.env.OPENCODE_BIN
    process.env.OPENCODE_BIN = "/tmp/opencode bin/opencode"

    try {
      const cmd = buildTmuxAttachCommand("http://localhost:3000", "ses_abc123")
      expect(cmd).toContain("/tmp/opencode bin/opencode")
      expect(cmd).toContain("attach")
    } finally {
      if (originalBin === undefined) {
        delete process.env.OPENCODE_BIN
      } else {
        process.env.OPENCODE_BIN = originalBin
      }
    }
  })

  it("keeps attach alive with a retry loop until opencode can attach or exits normally", () => {
    const cmd = buildTmuxAttachCommand("http://localhost:3000", "ses_abc123")
    expect(cmd).toContain("while true; do")
    expect(cmd).toContain("OMO attach not ready for ses_abc123; retrying in 1s...")
    expect(cmd).toContain('[ \"$code\" -eq 0 ]')
    expect(cmd).toContain('[ \"$code\" -eq 130 ]')
    expect(cmd).toContain('[ \"$code\" -eq 143 ]')
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
    expect(cmd).toContain("Attaching automatically when the session is ready.")
    expect(cmd).toContain("tail -f /dev/null")
    expect(cmd).not.toContain("opencode attach")
  })

  it("keeps single quotes and percent signs inside safe printf arguments", () => {
    const cmd = buildTmuxPlaceholderCommand("Fix Bob's 100% broken pane")
    expect(cmd).toContain("printf")
    expect(cmd).toContain("OMO subagent pane ready: Fix Bob")
    expect(cmd).toContain("100% broken pane")
  })
})
