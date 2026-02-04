import { describe, expect, test } from "bun:test"
import { enforceGitWriteRestriction } from "./git-write-enforcement"
import type { PreToolUseContext } from "./pre-tool-use"
import type { OhMyOpenCodeConfig } from "../../config/schema"

describe("Git Write Enforcement - Integration Tests", () => {
  //#given helper to create context
  function createContext(
    toolName: string,
    command: string,
    agent?: string
  ): PreToolUseContext {
    return {
      sessionId: "test-session",
      toolName,
      toolInput: toolName === "Bash" ? { command } : { tmux_command: command },
      cwd: "/test/path",
      agent,
    }
  }

  //#given empty config
  const emptyConfig: OhMyOpenCodeConfig = {}

  describe("End-to-End Enforcement Flow", () => {
    test("build agent + git push → blocked", () => {
      //#given build agent attempting git push
      const context = createContext("Bash", "git push origin main", "build")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is blocked
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Git write blocked")
      expect(result.reason).toContain("git-owner")
    })

    test("git-owner + git push → allowed", () => {
      //#given git-owner agent attempting git push
      const context = createContext("Bash", "git push origin main", "git-owner")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is allowed
      expect(result.blocked).toBe(false)
      expect(result.reason).toBeUndefined()
    })

    test("sisyphus + git commit → blocked", () => {
      //#given sisyphus agent attempting git commit
      const context = createContext("Bash", 'git commit -m "test"', "sisyphus")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is blocked
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Git write blocked")
    })

    test("any agent + git status → allowed (read operation)", () => {
      //#given any agent attempting git status (read)
      const context = createContext("Bash", "git status", "build")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is allowed (not a write)
      expect(result.blocked).toBe(false)
    })

    test("any agent + ls -la → allowed (not git)", () => {
      //#given any agent running non-git command
      const context = createContext("Bash", "ls -la", "build")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is allowed (not git)
      expect(result.blocked).toBe(false)
    })

    test("undefined agent + git push → blocked (safe default)", () => {
      //#given no agent specified for git push
      const context = createContext("Bash", "git push origin main", undefined)

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is blocked (safe default)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Git write blocked")
    })

    test("config without domainRestrictions → enforcement still works", () => {
      //#given config without domainRestrictions field
      const configWithoutRestrictions: OhMyOpenCodeConfig = {
        agents: { sisyphus: { model: "anthropic/claude-sonnet-4-5" } },
      }
      const context = createContext("Bash", "git push", "build")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, configWithoutRestrictions)

      //#then enforcement still works (backward compatible)
      expect(result.blocked).toBe(true)
    })
  })

  describe("Tool Name Handling", () => {
    test("Bash tool with git write → blocked for non-owner", () => {
      //#given Bash tool with git commit
      const context = createContext("Bash", "git commit -m 'test'", "sisyphus")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is blocked
      expect(result.blocked).toBe(true)
    })

    test("interactive_bash tool with git write → blocked for non-owner", () => {
      //#given interactive_bash tool with git push
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "interactive_bash",
        toolInput: { tmux_command: "git push" },
        cwd: "/test/path",
        agent: "build",
      }

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is blocked
      expect(result.blocked).toBe(true)
    })

    test("non-Bash tool → always allowed", () => {
      //#given non-Bash tool (even with git-like input)
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "Read",
        toolInput: { filePath: "git-file.txt" },
        cwd: "/test/path",
        agent: "build",
      }

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is allowed (not a bash tool)
      expect(result.blocked).toBe(false)
    })
  })

  describe("Complex Git Commands", () => {
    test("chained commands with git write → blocked", () => {
      //#given chained command with git commit
      const context = createContext(
        "Bash",
        'git add . && git commit -m "test" && git push',
        "build"
      )

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is blocked
      expect(result.blocked).toBe(true)
    })

    test("git command with full path → blocked for non-owner", () => {
      //#given git with full path
      const context = createContext("Bash", "/usr/bin/git push origin main", "sisyphus")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is blocked
      expect(result.blocked).toBe(true)
    })

    test("gh pr create → blocked for non-owner", () => {
      //#given gh pr create command
      const context = createContext("Bash", 'gh pr create --title "test"', "build")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is blocked
      expect(result.blocked).toBe(true)
    })

    test("gh pr list → allowed (read operation)", () => {
      //#given gh pr list (read)
      const context = createContext("Bash", "gh pr list", "build")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is allowed
      expect(result.blocked).toBe(false)
    })
  })

  describe("Edge Cases", () => {
    test("empty command → allowed", () => {
      //#given empty command
      const context = createContext("Bash", "", "build")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is allowed
      expect(result.blocked).toBe(false)
    })

    test("whitespace-only command → allowed", () => {
      //#given whitespace command
      const context = createContext("Bash", "   ", "build")

      //#when enforcement check runs
      const result = enforceGitWriteRestriction(context, emptyConfig)

      //#then operation is allowed
      expect(result.blocked).toBe(false)
    })

    test("git read commands → always allowed", () => {
      //#given various git read commands
      const readCommands = [
        "git status",
        "git log",
        "git diff",
        "git show",
        "git branch",
        "git remote -v",
      ]

      for (const cmd of readCommands) {
        const context = createContext("Bash", cmd, "build")
        const result = enforceGitWriteRestriction(context, emptyConfig)

        //#then all read operations allowed
        expect(result.blocked).toBe(false)
      }
    })

    test("git-owner can perform all write operations", () => {
      //#given git-owner with various write commands
      const writeCommands = [
        "git commit -m 'test'",
        "git push",
        "git merge feature",
        "git rebase main",
        "git tag v1.0.0",
        "gh pr create",
      ]

      for (const cmd of writeCommands) {
        const context = createContext("Bash", cmd, "git-owner")
        const result = enforceGitWriteRestriction(context, emptyConfig)

        //#then all operations allowed for git-owner
        expect(result.blocked).toBe(false)
      }
    })
  })

  describe("Context Flow Integration", () => {
    test("full context creation → classifier → enforcement → decision", () => {
      //#given complete PreToolUseContext
      const fullContext: PreToolUseContext = {
        sessionId: "integration-test-session",
        toolName: "Bash",
        toolInput: {
          command: "git push origin main",
          description: "Push changes to remote",
        },
        cwd: "/Users/test/project",
        transcriptPath: "/tmp/transcript.json",
        toolUseId: "tool-123",
        permissionMode: "default",
        agent: "build",
      }

      //#when enforcement runs with full context
      const result = enforceGitWriteRestriction(fullContext, emptyConfig)

      //#then enforcement properly processes full context
      expect(result.blocked).toBe(true)
      expect(result.reason).toBeDefined()
      expect(result.reason).toContain("git-owner")
    })

    test("enforcement integrates with existing config", () => {
      //#given existing user config with agents
      const userConfig: OhMyOpenCodeConfig = {
        agents: {
          sisyphus: { model: "anthropic/claude-sonnet-4-5" },
          "git-owner": { model: "anthropic/claude-sonnet-4-5" },
        },
        customAgents: {
          "git-owner": {
            model: "anthropic/claude-sonnet-4-5",
            promptPath: "~/git-owner/OWNER.md",
          },
        },
      }
      const context = createContext("Bash", "git push", "build")

      //#when enforcement runs with user config
      const result = enforceGitWriteRestriction(context, userConfig)

      //#then enforcement works with existing config
      expect(result.blocked).toBe(true)
    })
  })
})
