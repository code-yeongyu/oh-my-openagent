import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { buildTmuxAttachCommand, buildTmuxPlaceholderCommand } from "./pane-command"

describe("buildTmuxAttachCommand", () => {
  let originalPassword: string | undefined
  let originalUsername: string | undefined

  beforeEach(() => {
    originalPassword = process.env.OPENCODE_SERVER_PASSWORD
    originalUsername = process.env.OPENCODE_SERVER_USERNAME
    delete process.env.OPENCODE_SERVER_PASSWORD
    delete process.env.OPENCODE_SERVER_USERNAME
  })

  afterEach(() => {
    if (originalPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
    else process.env.OPENCODE_SERVER_PASSWORD = originalPassword
    if (originalUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME
    else process.env.OPENCODE_SERVER_USERNAME = originalUsername
  })

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

  it("propagates OPENCODE_SERVER_PASSWORD as an outer-shell env assignment when set", () => {
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    const cmd = buildTmuxAttachCommand("http://localhost:3000", "ses_abc123")
    // Env prefix must appear before `/bin/sh -c` so the child shell inherits it.
    expect(cmd.startsWith("OPENCODE_SERVER_PASSWORD='secret' /bin/sh -c \"")).toBe(true)
  })

  it("propagates both PASSWORD and USERNAME when username is set explicitly", () => {
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    process.env.OPENCODE_SERVER_USERNAME = "alice"
    const cmd = buildTmuxAttachCommand("http://localhost:3000", "ses_abc123")
    expect(cmd).toContain("OPENCODE_SERVER_PASSWORD='secret'")
    expect(cmd).toContain("OPENCODE_SERVER_USERNAME='alice'")
    expect(cmd.indexOf("OPENCODE_SERVER_PASSWORD"))
      .toBeLessThan(cmd.indexOf("/bin/sh -c"))
  })

  it("omits env prefix when no password is configured", () => {
    const cmd = buildTmuxAttachCommand("http://localhost:3000", "ses_abc123")
    expect(cmd.startsWith('/bin/sh -c "')).toBe(true)
    expect(cmd).not.toContain("OPENCODE_SERVER_PASSWORD")
    expect(cmd).not.toContain("OPENCODE_SERVER_USERNAME")
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
      expect(cmd.startsWith('/bin/sh -c "')).toBe(true)
      expect(cmd).not.toContain("/bin/csh -c")
    } finally {
      process.env.SHELL = originalShell
    }
  })

  it("produces inert placeholder command instead of immediate attach", () => {
    const cmd = buildTmuxPlaceholderCommand("My Task")
    expect(cmd).toContain("Focus this pane to attach.")
    expect(cmd).toContain("tail -f /dev/null")
    expect(cmd).not.toContain("opencode attach")
  })

  it("keeps single quotes and percent signs inside safe printf arguments", () => {
    const cmd = buildTmuxPlaceholderCommand("Fix Bob's 100% broken pane")
    expect(cmd).toContain(`printf '%s\\n%s\\n'`)
    expect(cmd).toContain(`"OMO subagent pane ready: Fix Bob's 100% broken pane"`)
  })
})
