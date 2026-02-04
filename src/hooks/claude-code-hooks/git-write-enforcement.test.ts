import { describe, test, expect } from "bun:test"
import { enforceGitWriteRestriction } from "./git-write-enforcement"
import type { PreToolUseContext } from "./pre-tool-use"
import type { OhMyOpenCodeConfig } from "../../config/schema"

describe("enforceGitWriteRestriction", () => {
  describe("non-git commands", () => {
    test("should allow non-git command (ls)", () => {
      // given - non-git command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "ls -la" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should allow
      expect(result.blocked).toBe(false)
    })

    test("should allow tool that is not Bash/interactive_bash", () => {
      // given - different tool (Read)
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "Read",
        toolInput: { filePath: "/test/file.ts" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should allow (not a Bash command)
      expect(result.blocked).toBe(false)
    })
  })

  describe("git read commands", () => {
    test("should allow git status (read command)", () => {
      // given - git read command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git status" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should allow (read command)
      expect(result.blocked).toBe(false)
    })

    test("should allow git log (read command)", () => {
      // given - git read command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git log --oneline" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should allow (read command)
      expect(result.blocked).toBe(false)
    })
  })

  describe("git write commands with git-owner agent", () => {
    test("should allow git commit when agent is git-owner", () => {
      // given - git write command from git-owner agent
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add feature'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should allow (git-owner can write)
      expect(result.blocked).toBe(false)
    })

    test("should allow git push when agent is git-owner", () => {
      // given - git push from git-owner agent
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git push origin main" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should allow
      expect(result.blocked).toBe(false)
    })
  })

  describe("git write commands with non-git-owner agent", () => {
    test("should block git commit when agent is not git-owner", () => {
      // given - git write command from sisyphus agent
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add feature'" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Git write blocked")
      expect(result.reason).toContain("git-owner")
    })

    test("should block git push when agent is not git-owner", () => {
      // given - git push from non-git-owner agent
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git push --force-with-lease" },
        cwd: "/test",
        agent: "Prometheus (Planner)",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Git write blocked")
    })

    test("should block git merge when agent is undefined", () => {
      // given - git write command with no agent
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git merge feature-branch" },
        cwd: "/test",
        // agent is undefined
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should block (no agent = not git-owner)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Git write blocked")
    })
  })

  describe("interactive_bash with git commands", () => {
    test("should block git push in interactive_bash when not git-owner", () => {
      // given - interactive_bash with git write command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "interactive_bash",
        toolInput: { tmux_command: "git push origin main" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Git write blocked")
    })

    test("should allow git status in interactive_bash", () => {
      // given - interactive_bash with git read command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "interactive_bash",
        toolInput: { tmux_command: "git status" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should allow (read command)
      expect(result.blocked).toBe(false)
    })
  })

  describe("mcp_bash tool with git commands", () => {
    test("should block git push with mcp_bash when agent is not git-owner", () => {
      //#given - mcp_bash tool with git push command from non-owner agent
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "mcp_bash",
        toolInput: { command: "git push origin main" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceGitWriteRestriction(context, config)

      //#then - should block (mcp_bash is treated like bash)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Git write blocked")
    })

    test("should allow git push with mcp_bash when agent is git-owner", () => {
      //#given - mcp_bash tool with git push command from git-owner agent
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "mcp_bash",
        toolInput: { command: "git push origin main" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceGitWriteRestriction(context, config)

      //#then - should allow (git-owner can write)
      expect(result.blocked).toBe(false)
    })

    test("should allow git status with mcp_bash when agent is not git-owner", () => {
      //#given - mcp_bash tool with git read command from non-owner agent
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "mcp_bash",
        toolInput: { command: "git status" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceGitWriteRestriction(context, config)

      //#then - should allow (read command, no write restriction)
      expect(result.blocked).toBe(false)
    })
  })

  describe("chained commands", () => {
    test("should block chained command with git write first", () => {
      // given - chained command with git write as first command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'fix: tests' && npm test" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should block (first command is git write)
      expect(result.blocked).toBe(true)
    })
  })

  describe("edge cases", () => {
    test("should handle empty command", () => {
      // given - empty command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should allow (no command)
      expect(result.blocked).toBe(false)
    })

    test("should handle missing command property", () => {
      // given - no command property
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: {},
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      // when
      const result = enforceGitWriteRestriction(context, config)

      // then - should allow (no command)
      expect(result.blocked).toBe(false)
    })

    test("backward compatibility: should allow non-git command with legacy Bash tool name", () => {
      //#given - legacy tool name "Bash" with non-git command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "Bash",
        toolInput: { command: "ls -la" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceGitWriteRestriction(context, config)

      //#then - should allow (backward compatibility)
      expect(result.blocked).toBe(false)
    })
  })
})
