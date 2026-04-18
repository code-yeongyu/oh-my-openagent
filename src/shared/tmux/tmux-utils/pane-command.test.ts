import { describe, expect, it } from "bun:test"
import { buildTmuxAttachCommand, buildTmuxPlaceholderCommand } from "./pane-command"

describe("buildTmuxAttachCommand", () => {
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
