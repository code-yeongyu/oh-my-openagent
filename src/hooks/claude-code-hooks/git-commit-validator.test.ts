import { describe, test, expect } from "bun:test"
import { validateGitCommit, type CommandExecutor } from "./git-commit-validator"
import type { PreToolUseContext } from "./pre-tool-use"
import type { OhMyOpenCodeConfig } from "../../config/schema"

describe("validateGitCommit", () => {
  describe("Agent Filtering", () => {
    test("should skip validation for non-git-owner agent", () => {
      //#given - sisyphus agent executing git commit
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'SYSTEM-1234 feat: 기능 추가'" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = validateGitCommit(context, config)

      //#then - should skip validation (not git-owner)
      expect(result.blocked).toBe(false)
    })

    test("should skip validation when agent is undefined", () => {
      //#given - no agent specified
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'WIP: incomplete work'" },
        cwd: "/test",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = validateGitCommit(context, config)

      //#then - should skip validation (no agent)
      expect(result.blocked).toBe(false)
    })

    test("should skip validation for non-commit commands", () => {
      //#given - git-owner executing git status (read command)
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git status" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = validateGitCommit(context, config)

      //#then - should skip validation (not a commit)
      expect(result.blocked).toBe(false)
    })
  })

  describe("JIRA Prefix Validation", () => {
    test("should block commit without JIRA prefix in company repo", () => {
      //#given - commit without JIRA in musinsa repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: 기능 추가'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/musinsa/project.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should block (missing JIRA)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("JIRA")
    })

    test("should allow commit with valid JIRA prefix in company repo", () => {
      //#given - commit with valid JIRA in musinsa repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: {
          command:
            "git commit -m 'SYSTEM-1234 feat: 기능 추가' -m 'Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>'",
        },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/musinsa/project.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (valid JIRA)
      expect(result.blocked).toBe(false)
    })

    test("should allow commit without JIRA in personal repo", () => {
      //#given - commit without JIRA in personal repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add feature'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (personal repo, no JIRA required)
      expect(result.blocked).toBe(false)
    })

    test("should accept various JIRA project key formats", () => {
      //#given - commits with different JIRA formats
      const validFormats = [
        {
          subject: "SYSTEM-1234 feat: 기능 추가",
          coAuthor: "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>",
        },
        {
          subject: "SNDDEV-6448 fix: 버그 수정",
          coAuthor: "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>",
        },
        {
          subject: "SRE-456 chore: 설정 변경",
          coAuthor: "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>",
        },
        {
          subject: "MSS-789 refactor: 코드 개선",
          coAuthor: "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>",
        },
      ]
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/musinsa/project.git"
        }
        return ""
      }

      for (const format of validFormats) {
        //#when
        const context: PreToolUseContext = {
          sessionId: "test-session",
          toolName: "bash",
          toolInput: { command: `git commit -m '${format.subject}' -m '${format.coAuthor}'` },
          cwd: "/test",
          agent: "git-owner",
        }
        const result = validateGitCommit(context, config, mockExecutor)

        //#then - should allow all formats
        expect(result.blocked).toBe(false)
      }
    })
  })

  describe("Korean Language Validation", () => {
    test("should block English commit message in company repo", () => {
      //#given - English commit in musinsa repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'SYSTEM-1234 feat: add feature'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/musinsa/project.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should block (English in company repo)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Korean")
    })

    test("should allow Korean commit message in company repo", () => {
      //#given - Korean commit in musinsa repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: {
          command:
            "git commit -m 'SYSTEM-1234 feat: 로그인 기능 추가' -m 'Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>'",
        },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/musinsa/project.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (Korean in company repo)
      expect(result.blocked).toBe(false)
    })

    test("should allow English commit message in personal repo", () => {
      //#given - English commit in personal repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add authentication'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (personal repo)
      expect(result.blocked).toBe(false)
    })
  })

  describe("Co-authored-by Validation", () => {
    test("should block commit without Co-authored-by in company repo", () => {
      //#given - commit without Co-authored-by in musinsa repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'SYSTEM-1234 feat: 기능 추가'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/musinsa/project.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should block (missing Co-authored-by)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Co-authored-by")
    })

    test("should allow commit with Co-authored-by in company repo", () => {
      //#given - commit with Co-authored-by in musinsa repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: {
          command:
            "git commit -m 'SYSTEM-1234 feat: 기능 추가' -m 'Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>'",
        },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/musinsa/project.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (has Co-authored-by)
      expect(result.blocked).toBe(false)
    })

    test("should allow commit without Co-authored-by in personal repo", () => {
      //#given - commit without Co-authored-by in personal repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add feature'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (personal repo)
      expect(result.blocked).toBe(false)
    })
  })

  describe("Forbidden Patterns", () => {
    test("should block WIP commit", () => {
      //#given - WIP commit in personal repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'WIP: incomplete feature'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should block (WIP pattern)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("WIP")
    })

    test("should block fixup commit", () => {
      //#given - fixup commit in personal repo
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'fixup! previous commit'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should block (fixup pattern)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("fixup")
    })
  })

  describe("Secret Detection", () => {
    test("should block commit with password in diff", () => {
      //#given - commit with password in staged changes
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add config'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        if (cmd.includes("git diff --staged")) {
          return '+  const password = "secret123"'
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should block (password detected)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("secret")
    })

    test("should allow commit with clean diff", () => {
      //#given - commit with clean changes
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add function'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        if (cmd.includes("git diff --staged")) {
          return "+  const x = calculateTotal()"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (no secrets)
      expect(result.blocked).toBe(false)
    })

    test("should allow commit when subprocess fails (fail-open)", () => {
      //#given - subprocess throws error
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add feature'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        throw new Error("subprocess failed")
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (fail-open policy)
      expect(result.blocked).toBe(false)
    })
  })

  describe("Forbidden Files", () => {
    test("should block commit with .env file", () => {
      //#given - commit with .env in staged files
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add config'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        if (cmd.includes("git diff --staged --name-only")) {
          return ".env\nsrc/config.ts"
        }
        if (cmd.includes("git diff --staged")) {
          return "+  const x = 1"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should block (.env file)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain(".env")
    })

    test("should block commit with .pem file", () => {
      //#given - commit with .pem file in staged files
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add cert'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        if (cmd.includes("git diff --staged --name-only")) {
          return "private.pem"
        }
        if (cmd.includes("git diff --staged")) {
          return "+  const x = 1"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should block (.pem file)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain(".pem")
    })

    test("should allow commit with clean files", () => {
      //#given - commit with normal files
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit -m 'feat: add function'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        if (cmd.includes("git diff --staged --name-only")) {
          return "src/app.ts\nsrc/utils.ts"
        }
        if (cmd.includes("git diff --staged")) {
          return "+  const x = 1"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (clean files)
      expect(result.blocked).toBe(false)
    })
  })

  describe("Chained Commands", () => {
    test("should validate git commit in chained command", () => {
      //#given - chained command with git commit
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git add . && git commit -m 'WIP: work in progress' && git push" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should block (WIP in chained command)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("WIP")
    })

    test("should validate git commit after non-git command", () => {
      //#given - chained command with npm test before git commit
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "npm test && git commit -m 'fixup! tests'" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should block (fixup pattern)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("fixup")
    })
  })

  describe("Edge Cases", () => {
    test("should handle commit without -m flag", () => {
      //#given - commit without message flag (will open editor)
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "git commit" },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/personal/repo.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (can't validate message from editor)
      expect(result.blocked).toBe(false)
    })

    test("should handle git commit --amend", () => {
      //#given - amend commit
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: {
          command:
            "git commit --amend -m 'SYSTEM-1234 feat: 기능 추가' -m 'Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>'",
        },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/musinsa/project.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should validate message (even for amend)
      expect(result.blocked).toBe(false)
    })

    test("should handle multiple -m flags", () => {
      //#given - commit with multiple -m flags (subject + body)
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: {
          command:
            "git commit -m 'SYSTEM-1234 feat: 기능 추가' -m 'Additional details' -m 'Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>'",
        },
        cwd: "/test",
        agent: "git-owner",
      }
      const config = {} as OhMyOpenCodeConfig
      const mockExecutor: CommandExecutor = (cmd: string) => {
        if (cmd.includes("git remote get-url origin")) {
          return "https://github.com/musinsa/project.git"
        }
        return ""
      }

      //#when
      const result = validateGitCommit(context, config, mockExecutor)

      //#then - should allow (valid format with Co-authored-by)
      expect(result.blocked).toBe(false)
    })
  })
})
