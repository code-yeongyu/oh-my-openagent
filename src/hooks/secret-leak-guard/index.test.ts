import { describe, expect, test } from "bun:test"
import { isGitCommitOrPush, isGitPush } from "./git-command-detector"
import { extractRemoteBranch, formatFindings } from "./result-formatter"

describe("git-command-detector", () => {
  describe("isGitCommitOrPush", () => {
    test("detects git commit -m", () => {
      //#given
      const command = 'git commit -m "feat: add login"'
      //#then
      expect(isGitCommitOrPush(command)).toBe(true)
    })

    test("detects git push", () => {
      //#given
      const command = "git push origin dev"
      //#then
      expect(isGitCommitOrPush(command)).toBe(true)
    })

    test("detects git add && git commit chain", () => {
      //#given
      const command = 'git add . && git commit -m "fix: typo"'
      //#then
      expect(isGitCommitOrPush(command)).toBe(true)
    })

    test("ignores git status", () => {
      //#given
      const command = "git status"
      //#then
      expect(isGitCommitOrPush(command)).toBe(false)
    })

    test("ignores git diff", () => {
      //#given
      const command = "git diff --staged"
      //#then
      expect(isGitCommitOrPush(command)).toBe(false)
    })

    test("ignores git log", () => {
      //#given
      const command = "git log --oneline -10"
      //#then
      expect(isGitCommitOrPush(command)).toBe(false)
    })

    test("ignores non-git commands", () => {
      //#given
      const command = "bun test"
      //#then
      expect(isGitCommitOrPush(command)).toBe(false)
    })

    test("detects git push --force-with-lease", () => {
      //#given
      const command = "git push --force-with-lease origin feature/auth"
      //#then
      expect(isGitCommitOrPush(command)).toBe(true)
    })
  })

  describe("isGitPush", () => {
    test("detects git push", () => {
      expect(isGitPush("git push origin dev")).toBe(true)
    })

    test("does not match git commit", () => {
      expect(isGitPush('git commit -m "msg"')).toBe(false)
    })
  })
})

describe("result-formatter", () => {
  describe("formatFindings", () => {
    test("formats single finding", () => {
      //#given
      const findings = [{
        RuleID: "aws-access-key",
        Match: "AKIA...",
        File: "config.ts",
        StartLine: 10,
        EndLine: 10,
        Description: "AWS Access Key",
      }]

      //#when
      const result = formatFindings(findings)

      //#then
      expect(result).toContain("aws-access-key")
      expect(result).toContain("config.ts:10")
      expect(result).toContain("AWS Access Key")
    })

    test("formats multiple findings", () => {
      //#given
      const findings = [
        { RuleID: "generic-api-key", Match: "sk-...", File: "src/api.ts", StartLine: 5, EndLine: 5, Description: "API Key" },
        { RuleID: "private-key", Match: "-----BEGIN", File: "certs/key.pem", StartLine: 1, EndLine: 20, Description: "Private Key" },
      ]

      //#when
      const result = formatFindings(findings)

      //#then
      expect(result).toContain("1.")
      expect(result).toContain("2.")
      expect(result).toContain("src/api.ts:5")
      expect(result).toContain("certs/key.pem:1")
    })
  })

  describe("extractRemoteBranch", () => {
    test("extracts branch from git push origin dev", () => {
      expect(extractRemoteBranch("git push origin dev")).toBe("dev")
    })

    test("extracts branch from git push origin feature/auth", () => {
      expect(extractRemoteBranch("git push origin feature/auth")).toBe("feature/auth")
    })

    test("returns default when no branch specified", () => {
      expect(extractRemoteBranch("git push")).toBe("origin/dev")
    })
  })
})
