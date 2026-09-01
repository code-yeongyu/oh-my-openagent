import { describe, expect, it } from "bun:test"
import { shellEscapeForDoubleQuotedCommand } from "../../shell-env"

describe("given a serverUrl with shell metacharacters", () => {
  describe("when building tmux spawn command with double quotes", () => {
    it("then serverUrl is escaped to prevent shell injection", () => {
      const serverUrl = "http://localhost:3000'; cat /etc/passwd; echo '"
      const sessionId = "test-session"
      const shell = "/bin/sh"

      // Use double quotes for outer shell -c command, escape dangerous chars in URL
      const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
      const opencodeCmd = `${shell} -c "opencode attach ${escapedUrl} --session ${sessionId}"`

      // The semicolon should be escaped so it's treated as literal, not separator
      expect(opencodeCmd).toContain("\\;")
      // The malicious content should be escaped - semicolons are now \\;
      expect(opencodeCmd).not.toMatch(/[^\\];\s*cat/)
    })
  })

  describe("when building tmux replace command", () => {
    it("then serverUrl is escaped to prevent shell injection", () => {
      const serverUrl = "http://localhost:3000'; rm -rf /; '"
      const sessionId = "test-session"
      const shell = "/bin/sh"

      const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
      const opencodeCmd = `${shell} -c "opencode attach ${escapedUrl} --session ${sessionId}"`

      expect(opencodeCmd).toContain("\\;")
      expect(opencodeCmd).not.toMatch(/[^\\];\s*rm/)
    })
  })
})

describe("given a normal serverUrl without shell metacharacters", () => {
  describe("when building tmux spawn command", () => {
    it("then serverUrl works correctly", () => {
      const serverUrl = "http://localhost:3000"
      const sessionId = "test-session"
      const shell = "/bin/sh"

      const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
      const opencodeCmd = `${shell} -c "opencode attach ${escapedUrl} --session ${sessionId}"`

      expect(opencodeCmd).toContain(serverUrl)
    })
  })
})

describe("given a serverUrl with dollar sign (command injection)", () => {
  describe("when building tmux command", () => {
    it("then dollar sign is escaped properly", () => {
      const serverUrl = "http://localhost:3000$(whoami)"
      const sessionId = "test-session"
      const shell = "/bin/sh"

      const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
      const opencodeCmd = `${shell} -c "opencode attach ${escapedUrl} --session ${sessionId}"`

      // The $ should be escaped to literal $
      expect(opencodeCmd).toContain("\\$")
    })
  })
})

describe("given a serverUrl with backticks (command injection)", () => {
  describe("when building tmux command", () => {
    it("then backticks are escaped properly", () => {
      const serverUrl = "http://localhost:3000`whoami`"
      const sessionId = "test-session"
      const shell = "/bin/sh"

      const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
      const opencodeCmd = `${shell} -c "opencode attach ${escapedUrl} --session ${sessionId}"`

      expect(opencodeCmd).toContain("\\`")
    })
  })
})

describe("given a serverUrl with pipe operator", () => {
  describe("when building tmux command", () => {
    it("then pipe is escaped properly", () => {
      const serverUrl = "http://localhost:3000 | ls"
      const sessionId = "test-session"
      const shell = "/bin/sh"

      const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
      const opencodeCmd = `${shell} -c "opencode attach ${escapedUrl} --session ${sessionId}"`

      expect(opencodeCmd).toContain("\\|")
    })
  })
})
