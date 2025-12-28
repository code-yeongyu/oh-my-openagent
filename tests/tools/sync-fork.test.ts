/**
 * Tests for sync-fork tool (LIF-74)
 *
 * These tests verify the sync-fork tool utilities for state management,
 * git parsing, commit analysis, and report generation.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// State management functions
import {
  createDefaultState,
  readState,
  atomicWriteState,
  deleteState,
  getOrCreateState,
  updateCommitStatus,
  markCommitAsSynced,
  markCommitAsSkipped,
  markCommitAsReviewed,
  updateLastReviewed,
  isCommitInState,
  getNewCommits,
} from "../../src/tools/sync-fork/state"

// Constants
import {
  STATE_FILE_PATH,
  DEFAULT_UPSTREAM_REMOTE,
  DEFAULT_UPSTREAM_BRANCH,
  FALLBACK_UPSTREAM_BRANCHES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SECURITY_KEYWORDS,
  COMMIT_TYPE_PATTERNS,
  PRIORITY_LABELS,
  GIT_LOG_FORMAT,
  GIT_DATE_FORMAT,
} from "../../src/tools/sync-fork/constants"

// Analysis functions
import {
  suggestPriority,
  createFallbackAnalysis,
  parseAIResponse,
} from "../../src/tools/sync-fork/analysis"

// Report functions
import {
  groupCommitsByScope,
  type CommitGroup,
} from "../../src/tools/sync-fork/report"

// Types
import type { SyncForkState, ParsedCommit, Priority } from "../../src/tools/sync-fork/types"

// --------------------------------------------------------
// CONSTANTS TESTS
// --------------------------------------------------------

describe("Sync Fork Constants", () => {
  describe("State file configuration", () => {
    test("should have correct state file path", () => {
      expect(STATE_FILE_PATH).toBe(".opencode/state/sync-fork.json")
    })
  })

  describe("Upstream defaults", () => {
    test("should have correct default upstream remote", () => {
      expect(DEFAULT_UPSTREAM_REMOTE).toBe("upstream")
    })

    test("should have correct default upstream branch", () => {
      expect(DEFAULT_UPSTREAM_BRANCH).toBe("main")
    })

    test("should have fallback branches", () => {
      expect(FALLBACK_UPSTREAM_BRANCHES).toContain("main")
      expect(FALLBACK_UPSTREAM_BRANCHES).toContain("master")
    })
  })

  describe("Limits", () => {
    test("should have reasonable default limit", () => {
      expect(DEFAULT_LIMIT).toBe(50)
    })

    test("should have max limit greater than default", () => {
      expect(MAX_LIMIT).toBeGreaterThan(DEFAULT_LIMIT)
      expect(MAX_LIMIT).toBe(200)
    })
  })

  describe("Security keywords", () => {
    test("should include common security terms", () => {
      expect(SECURITY_KEYWORDS).toContain("cve")
      expect(SECURITY_KEYWORDS).toContain("vulnerability")
      expect(SECURITY_KEYWORDS).toContain("security")
      expect(SECURITY_KEYWORDS).toContain("xss")
      expect(SECURITY_KEYWORDS).toContain("injection")
    })

    test("should have at least 10 security keywords", () => {
      expect(SECURITY_KEYWORDS.length).toBeGreaterThanOrEqual(10)
    })
  })

  describe("Commit type patterns", () => {
    test("should map feat to feat", () => {
      expect(COMMIT_TYPE_PATTERNS["feat"]).toBe("feat")
      expect(COMMIT_TYPE_PATTERNS["feature"]).toBe("feat")
    })

    test("should map fix to fix", () => {
      expect(COMMIT_TYPE_PATTERNS["fix"]).toBe("fix")
      expect(COMMIT_TYPE_PATTERNS["bug"]).toBe("fix")
    })

    test("should map perf to perf", () => {
      expect(COMMIT_TYPE_PATTERNS["perf"]).toBe("perf")
      expect(COMMIT_TYPE_PATTERNS["performance"]).toBe("perf")
    })

    test("should map security to security", () => {
      expect(COMMIT_TYPE_PATTERNS["security"]).toBe("security")
      expect(COMMIT_TYPE_PATTERNS["sec"]).toBe("security")
    })

    test("should map docs to docs", () => {
      expect(COMMIT_TYPE_PATTERNS["docs"]).toBe("docs")
      expect(COMMIT_TYPE_PATTERNS["doc"]).toBe("docs")
    })

    test("should map test to test", () => {
      expect(COMMIT_TYPE_PATTERNS["test"]).toBe("test")
      expect(COMMIT_TYPE_PATTERNS["tests"]).toBe("test")
    })
  })

  describe("Priority labels", () => {
    test("should have labels for all priorities", () => {
      expect(PRIORITY_LABELS["P0"]).toBeDefined()
      expect(PRIORITY_LABELS["P1"]).toBeDefined()
      expect(PRIORITY_LABELS["P2"]).toBeDefined()
      expect(PRIORITY_LABELS["P3"]).toBeDefined()
    })

    test("should include sync-upstream label in all priorities", () => {
      expect(PRIORITY_LABELS["P0"]).toContain("sync-upstream")
      expect(PRIORITY_LABELS["P1"]).toContain("sync-upstream")
      expect(PRIORITY_LABELS["P2"]).toContain("sync-upstream")
      expect(PRIORITY_LABELS["P3"]).toContain("sync-upstream")
    })
  })

  describe("Git log format", () => {
    test("should have correct log format with separators", () => {
      expect(GIT_LOG_FORMAT).toContain("%H") // Full hash
      expect(GIT_LOG_FORMAT).toContain("%an") // Author name
      expect(GIT_LOG_FORMAT).toContain("%ad") // Author date
      expect(GIT_LOG_FORMAT).toContain("%s") // Subject
      expect(GIT_LOG_FORMAT).toContain("%P") // Parent hashes
    })

    test("should have correct date format", () => {
      expect(GIT_DATE_FORMAT).toBe("iso-strict")
    })
  })
})

// --------------------------------------------------------
// STATE MANAGEMENT TESTS
// --------------------------------------------------------

describe("Sync Fork State Management", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `sync-fork-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("createDefaultState", () => {
    test("should create state with version 1", () => {
      const state = createDefaultState()
      expect(state.version).toBe(1)
    })

    test("should have default upstream configuration", () => {
      const state = createDefaultState()
      expect(state.upstream.remote).toBe(DEFAULT_UPSTREAM_REMOTE)
      expect(state.upstream.branch).toBe(DEFAULT_UPSTREAM_BRANCH)
    })

    test("should have valid ISO timestamp for lastFetchedAt", () => {
      const state = createDefaultState()
      const date = new Date(state.upstream.lastFetchedAt)
      expect(date.getTime()).not.toBeNaN()
    })

    test("should have null lastReviewedCommit", () => {
      const state = createDefaultState()
      expect(state.lastReviewedCommit).toBeNull()
    })

    test("should have null lastReviewedAt", () => {
      const state = createDefaultState()
      expect(state.lastReviewedAt).toBeNull()
    })

    test("should have empty commits object", () => {
      const state = createDefaultState()
      expect(state.commits).toEqual({})
    })
  })

  describe("readState", () => {
    test("should return null when state file does not exist", () => {
      const state = readState(testDir)
      expect(state).toBeNull()
    })

    test("should read valid state file", async () => {
      const originalState = createDefaultState()
      await atomicWriteState(originalState, testDir)

      const readStateResult = readState(testDir)
      expect(readStateResult).not.toBeNull()
      expect(readStateResult?.version).toBe(1)
    })

    test("should return null for invalid JSON", async () => {
      const statePath = join(testDir, STATE_FILE_PATH)
      mkdirSync(join(testDir, ".opencode/state"), { recursive: true })
      await Bun.write(statePath, "invalid json {{{")

      const state = readState(testDir)
      expect(state).toBeNull()
    })

    test("should return null for wrong version", async () => {
      const statePath = join(testDir, STATE_FILE_PATH)
      mkdirSync(join(testDir, ".opencode/state"), { recursive: true })
      await Bun.write(statePath, JSON.stringify({ version: 999 }))

      const state = readState(testDir)
      expect(state).toBeNull()
    })
  })

  describe("atomicWriteState", () => {
    test("should create state file", async () => {
      const state = createDefaultState()
      await atomicWriteState(state, testDir)

      const statePath = join(testDir, STATE_FILE_PATH)
      expect(existsSync(statePath)).toBe(true)
    })

    test("should write valid JSON", async () => {
      const state = createDefaultState()
      await atomicWriteState(state, testDir)

      const statePath = join(testDir, STATE_FILE_PATH)
      const content = readFileSync(statePath, "utf-8")
      const parsed = JSON.parse(content)
      expect(parsed.version).toBe(1)
    })

    test("should create parent directories", async () => {
      const state = createDefaultState()
      await atomicWriteState(state, testDir)

      const stateDir = join(testDir, ".opencode/state")
      expect(existsSync(stateDir)).toBe(true)
    })
  })

  describe("deleteState", () => {
    test("should return false when state file does not exist", async () => {
      const result = await deleteState(testDir)
      expect(result).toBe(false)
    })

    test("should delete existing state file", async () => {
      const state = createDefaultState()
      await atomicWriteState(state, testDir)

      const result = await deleteState(testDir)
      expect(result).toBe(true)

      const statePath = join(testDir, STATE_FILE_PATH)
      expect(existsSync(statePath)).toBe(false)
    })
  })

  describe("getOrCreateState", () => {
    test("should return existing state if present", async () => {
      const originalState = createDefaultState()
      originalState.lastReviewedCommit = "abc123"
      await atomicWriteState(originalState, testDir)

      const state = getOrCreateState(testDir)
      expect(state.lastReviewedCommit).toBe("abc123")
    })

    test("should create new state if not present", () => {
      const state = getOrCreateState(testDir)
      expect(state.version).toBe(1)
      expect(state.lastReviewedCommit).toBeNull()
    })
  })

  describe("updateCommitStatus", () => {
    test("should add commit with status", () => {
      const state = createDefaultState()
      updateCommitStatus(state, "abc123", "synced")

      expect(state.commits["abc123"]).toBeDefined()
      expect(state.commits["abc123"].status).toBe("synced")
    })

    test("should add commit with PR number", () => {
      const state = createDefaultState()
      updateCommitStatus(state, "abc123", "synced", { pr: "42" })

      expect(state.commits["abc123"].pr).toBe("42")
    })

    test("should add commit with reason", () => {
      const state = createDefaultState()
      updateCommitStatus(state, "abc123", "skipped", { reason: "Not relevant" })

      expect(state.commits["abc123"].reason).toBe("Not relevant")
    })

    test("should add commit with recommendation", () => {
      const state = createDefaultState()
      updateCommitStatus(state, "abc123", "reviewed", { recommendation: "P1" })

      expect(state.commits["abc123"].recommendation).toBe("P1")
    })

    test("should set reviewedAt timestamp", () => {
      const state = createDefaultState()
      updateCommitStatus(state, "abc123", "synced")

      const date = new Date(state.commits["abc123"].reviewedAt)
      expect(date.getTime()).not.toBeNaN()
    })
  })

  describe("markCommitAsSynced", () => {
    test("should mark commit as synced with PR number", () => {
      const state = createDefaultState()
      markCommitAsSynced(state, "abc123", "42")

      expect(state.commits["abc123"].status).toBe("synced")
      expect(state.commits["abc123"].pr).toBe("42")
    })
  })

  describe("markCommitAsSkipped", () => {
    test("should mark commit as skipped with reason", () => {
      const state = createDefaultState()
      markCommitAsSkipped(state, "abc123", "Not applicable to fork")

      expect(state.commits["abc123"].status).toBe("skipped")
      expect(state.commits["abc123"].reason).toBe("Not applicable to fork")
    })
  })

  describe("markCommitAsReviewed", () => {
    test("should mark commit as reviewed with priority recommendation", () => {
      const state = createDefaultState()
      markCommitAsReviewed(state, "abc123", "P0")

      expect(state.commits["abc123"].status).toBe("reviewed")
      expect(state.commits["abc123"].recommendation).toBe("P0")
    })

    test("should mark commit as reviewed with Skip recommendation", () => {
      const state = createDefaultState()
      markCommitAsReviewed(state, "abc123", "Skip")

      expect(state.commits["abc123"].status).toBe("reviewed")
      expect(state.commits["abc123"].recommendation).toBe("Skip")
    })
  })

  describe("updateLastReviewed", () => {
    test("should update lastReviewedCommit", () => {
      const state = createDefaultState()
      updateLastReviewed(state, "abc123")

      expect(state.lastReviewedCommit).toBe("abc123")
    })

    test("should update lastReviewedAt timestamp", () => {
      const state = createDefaultState()
      updateLastReviewed(state, "abc123")

      expect(state.lastReviewedAt).not.toBeNull()
      const date = new Date(state.lastReviewedAt!)
      expect(date.getTime()).not.toBeNaN()
    })
  })

  describe("isCommitInState", () => {
    test("should return true for existing commit", () => {
      const state = createDefaultState()
      updateCommitStatus(state, "abc123", "synced")

      expect(isCommitInState(state, "abc123")).toBe(true)
    })

    test("should return false for non-existing commit", () => {
      const state = createDefaultState()

      expect(isCommitInState(state, "abc123")).toBe(false)
    })
  })

  describe("getNewCommits", () => {
    test("should return all commits when state is empty", () => {
      const state = createDefaultState()
      const allShas = ["abc123", "def456", "ghi789"]

      const newCommits = getNewCommits(state, allShas)
      expect(newCommits).toEqual(allShas)
    })

    test("should filter out existing commits", () => {
      const state = createDefaultState()
      updateCommitStatus(state, "abc123", "synced")
      updateCommitStatus(state, "def456", "skipped")

      const allShas = ["abc123", "def456", "ghi789", "jkl012"]
      const newCommits = getNewCommits(state, allShas)

      expect(newCommits).toEqual(["ghi789", "jkl012"])
    })

    test("should return empty array when all commits exist", () => {
      const state = createDefaultState()
      updateCommitStatus(state, "abc123", "synced")
      updateCommitStatus(state, "def456", "synced")

      const allShas = ["abc123", "def456"]
      const newCommits = getNewCommits(state, allShas)

      expect(newCommits).toEqual([])
    })
  })
})

// --------------------------------------------------------
// GIT PARSING TESTS (via analysis.ts)
// --------------------------------------------------------

describe("Sync Fork Analysis", () => {
  // Helper to create a mock ParsedCommit
  function createMockCommit(overrides: Partial<ParsedCommit> = {}): ParsedCommit {
    return {
      sha: "abc123def456",
      shortSha: "abc123d",
      type: "feat",
      subject: "Add new feature",
      author: "Test Author",
      date: "2024-01-01T00:00:00Z",
      files: [],
      isBreaking: false,
      isMerge: false,
      ...overrides,
    }
  }

  describe("suggestPriority", () => {
    describe("P0 - Critical priority", () => {
      test("should return P0 for security type commits", () => {
        const commit = createMockCommit({ type: "security" })
        expect(suggestPriority(commit)).toBe("P0")
      })

      test("should return P0 for commits with CVE in subject", () => {
        const commit = createMockCommit({
          type: "fix",
          subject: "Fix CVE-2024-1234 vulnerability",
        })
        expect(suggestPriority(commit)).toBe("P0")
      })

      test("should return P0 for commits with vulnerability keyword", () => {
        const commit = createMockCommit({
          type: "fix",
          subject: "Fix critical vulnerability in auth",
        })
        expect(suggestPriority(commit)).toBe("P0")
      })

      test("should return P0 for commits with security keyword", () => {
        const commit = createMockCommit({
          type: "chore",
          subject: "Security hardening for API endpoints",
        })
        expect(suggestPriority(commit)).toBe("P0")
      })

      test("should return P0 for commits with XSS keyword", () => {
        const commit = createMockCommit({
          type: "fix",
          subject: "Prevent XSS attack in user input",
        })
        expect(suggestPriority(commit)).toBe("P0")
      })

      test("should return P0 for commits with injection keyword", () => {
        const commit = createMockCommit({
          type: "fix",
          subject: "Fix SQL injection vulnerability",
        })
        expect(suggestPriority(commit)).toBe("P0")
      })
    })

    describe("P1 - High priority", () => {
      test("should return P1 for fix type commits without high risk files", () => {
        const commit = createMockCommit({
          type: "fix",
          subject: "Fix button alignment",
          files: [{ path: "src/components/Button.tsx", status: "M" }],
        })
        expect(suggestPriority(commit)).toBe("P1")
      })
    })

    describe("P2 - Medium priority", () => {
      test("should return P2 for perf type commits", () => {
        const commit = createMockCommit({ type: "perf" })
        expect(suggestPriority(commit)).toBe("P2")
      })

      test("should return P2 for feat type commits", () => {
        const commit = createMockCommit({ type: "feat" })
        expect(suggestPriority(commit)).toBe("P2")
      })
    })

    describe("P3 - Low priority", () => {
      test("should return P3 for docs type commits", () => {
        const commit = createMockCommit({ type: "docs" })
        expect(suggestPriority(commit)).toBe("P3")
      })

      test("should return P3 for test type commits", () => {
        const commit = createMockCommit({ type: "test" })
        expect(suggestPriority(commit)).toBe("P3")
      })

      test("should return P3 for chore type commits", () => {
        const commit = createMockCommit({ type: "chore" })
        expect(suggestPriority(commit)).toBe("P3")
      })

      test("should return P3 for other type commits", () => {
        const commit = createMockCommit({ type: "other" })
        expect(suggestPriority(commit)).toBe("P3")
      })

      test("should return P3 for refactor type commits", () => {
        const commit = createMockCommit({ type: "refactor" })
        expect(suggestPriority(commit)).toBe("P3")
      })
    })
  })

  describe("createFallbackAnalysis", () => {
    test("should create analysis with commit sha", () => {
      const commit = createMockCommit({ sha: "abc123" })
      const analysis = createFallbackAnalysis(commit)

      expect(analysis.commitSha).toBe("abc123")
    })

    test("should use suggestPriority for priority", () => {
      const commit = createMockCommit({ type: "security" })
      const analysis = createFallbackAnalysis(commit)

      expect(analysis.priority).toBe("P0")
    })

    test("should include commit type in reasoning", () => {
      const commit = createMockCommit({ type: "fix" })
      const analysis = createFallbackAnalysis(commit)

      expect(analysis.reasoning).toContain("fix")
    })

    test("should set action to sync_immediately for P0", () => {
      const commit = createMockCommit({ type: "security" })
      const analysis = createFallbackAnalysis(commit)

      expect(analysis.action).toBe("sync_immediately")
    })

    test("should set action to queue_for_batch for non-P0", () => {
      const commit = createMockCommit({ type: "feat" })
      const analysis = createFallbackAnalysis(commit)

      expect(analysis.action).toBe("queue_for_batch")
    })

    test("should extract affected areas from file paths", () => {
      const commit = createMockCommit({
        files: [
          { path: "src/tools/sync-fork/state.ts", status: "M" },
          { path: "src/hooks/test/index.ts", status: "A" },
        ],
      })
      const analysis = createFallbackAnalysis(commit)

      expect(analysis.affectedAreas).toContain("src/tools")
      expect(analysis.affectedAreas).toContain("src/hooks")
    })
  })

  describe("parseAIResponse", () => {
    test("should parse valid JSON response", () => {
      const response = `Here is my analysis:
{
  "priority": "P1",
  "reasoning": "This is a bug fix that should be synced soon.",
  "conflictLikelihood": "unlikely",
  "action": "queue_for_batch",
  "affectedAreas": ["src/tools", "src/hooks"]
}`
      const result = parseAIResponse(response)

      expect(result).not.toBeNull()
      expect(result?.priority).toBe("P1")
      expect(result?.reasoning).toBe("This is a bug fix that should be synced soon.")
      expect(result?.conflictLikelihood).toBe("unlikely")
      expect(result?.action).toBe("queue_for_batch")
      expect(result?.affectedAreas).toEqual(["src/tools", "src/hooks"])
    })

    test("should return null for response without JSON", () => {
      const response = "This is just plain text without any JSON."
      const result = parseAIResponse(response)

      expect(result).toBeNull()
    })

    test("should return null for invalid priority", () => {
      const response = `{
  "priority": "INVALID",
  "reasoning": "Test",
  "conflictLikelihood": "unlikely",
  "action": "skip"
}`
      const result = parseAIResponse(response)

      expect(result).toBeNull()
    })

    test("should accept Skip as valid priority", () => {
      const response = `{
  "priority": "Skip",
  "reasoning": "Not relevant to our fork.",
  "conflictLikelihood": "unlikely",
  "action": "skip"
}`
      const result = parseAIResponse(response)

      expect(result).not.toBeNull()
      expect(result?.priority).toBe("Skip")
    })

    test("should provide defaults for missing optional fields", () => {
      const response = `{
  "priority": "P2"
}`
      const result = parseAIResponse(response)

      expect(result).not.toBeNull()
      expect(result?.reasoning).toBe("No reasoning provided")
      expect(result?.conflictLikelihood).toBe("possible")
      expect(result?.action).toBe("queue_for_batch")
      expect(result?.affectedAreas).toEqual([])
    })

    test("should extract JSON from mixed content", () => {
      const response = `
Based on my analysis of the commit, here are my findings:

\`\`\`json
{
  "priority": "P0",
  "reasoning": "Critical security fix.",
  "conflictLikelihood": "likely",
  "action": "sync_immediately",
  "affectedAreas": ["src/auth"]
}
\`\`\`

Please sync this immediately.
`
      const result = parseAIResponse(response)

      expect(result).not.toBeNull()
      expect(result?.priority).toBe("P0")
    })

    test("should return null for malformed JSON", () => {
      const response = `{ "priority": "P1", broken json }`
      const result = parseAIResponse(response)

      expect(result).toBeNull()
    })
  })
})

// --------------------------------------------------------
// REPORT GENERATION TESTS
// --------------------------------------------------------

describe("Sync Fork Report Generation", () => {
  // Helper to create a mock ParsedCommit
  function createMockCommit(overrides: Partial<ParsedCommit> = {}): ParsedCommit {
    return {
      sha: "abc123def456",
      shortSha: "abc123d",
      type: "feat",
      subject: "Add new feature",
      author: "Test Author",
      date: "2024-01-01T00:00:00Z",
      files: [],
      isBreaking: false,
      isMerge: false,
      ...overrides,
    }
  }

  describe("groupCommitsByScope", () => {
    test("should group commits by PR number", () => {
      const commits = [
        createMockCommit({ sha: "a1", prNumber: "42", subject: "Fix #42" }),
        createMockCommit({ sha: "a2", prNumber: "42", subject: "More fixes #42" }),
        createMockCommit({ sha: "b1", prNumber: "43", subject: "Feature #43" }),
      ]

      const groups = groupCommitsByScope(commits)

      const pr42Group = groups.find((g) => g.prNumber === "42")
      const pr43Group = groups.find((g) => g.prNumber === "43")

      expect(pr42Group).toBeDefined()
      expect(pr42Group?.commits.length).toBe(2)
      expect(pr43Group).toBeDefined()
      expect(pr43Group?.commits.length).toBe(1)
    })

    test("should group commits by scope when no PR number", () => {
      const commits = [
        createMockCommit({ sha: "a1", scope: "auth", subject: "feat(auth): add login" }),
        createMockCommit({ sha: "a2", scope: "auth", subject: "feat(auth): add logout" }),
        createMockCommit({ sha: "b1", scope: "api", subject: "fix(api): handle errors" }),
      ]

      const groups = groupCommitsByScope(commits)

      const authGroup = groups.find((g) => g.scope === "auth")
      const apiGroup = groups.find((g) => g.scope === "api")

      expect(authGroup).toBeDefined()
      expect(authGroup?.commits.length).toBe(2)
      expect(apiGroup).toBeDefined()
      expect(apiGroup?.commits.length).toBe(1)
    })

    test("should group commits by type when no PR or scope", () => {
      const commits = [
        createMockCommit({ sha: "a1", type: "fix", subject: "Fix bug 1" }),
        createMockCommit({ sha: "a2", type: "fix", subject: "Fix bug 2" }),
        createMockCommit({ sha: "b1", type: "feat", subject: "Add feature" }),
      ]

      const groups = groupCommitsByScope(commits)

      const fixGroup = groups.find((g) => g.groupId === "type-fix")
      const featGroup = groups.find((g) => g.groupId === "type-feat")

      expect(fixGroup).toBeDefined()
      expect(fixGroup?.commits.length).toBe(2)
      expect(featGroup).toBeDefined()
      expect(featGroup?.commits.length).toBe(1)
    })

    test("should prioritize PR number over scope", () => {
      const commits = [
        createMockCommit({
          sha: "a1",
          prNumber: "42",
          scope: "auth",
          subject: "feat(auth): add login #42",
        }),
      ]

      const groups = groupCommitsByScope(commits)

      expect(groups.length).toBe(1)
      expect(groups[0].prNumber).toBe("42")
      expect(groups[0].scope).toBeUndefined()
    })

    test("should prioritize scope over type", () => {
      const commits = [
        createMockCommit({
          sha: "a1",
          type: "feat",
          scope: "auth",
          subject: "feat(auth): add login",
        }),
      ]

      const groups = groupCommitsByScope(commits)

      expect(groups.length).toBe(1)
      expect(groups[0].scope).toBe("auth")
      expect(groups[0].groupId).toBe("scope-auth")
    })

    test("should sort groups by priority (P0 first)", () => {
      const commits = [
        createMockCommit({ sha: "a1", type: "docs", subject: "Update docs" }),
        createMockCommit({ sha: "b1", type: "security", subject: "Fix CVE" }),
        createMockCommit({ sha: "c1", type: "feat", subject: "Add feature" }),
      ]

      const groups = groupCommitsByScope(commits)

      // Security should be first (P0)
      expect(groups[0].commits[0].type).toBe("security")
    })

    test("should return empty array for empty input", () => {
      const groups = groupCommitsByScope([])
      expect(groups).toEqual([])
    })
  })
})

// --------------------------------------------------------
// INTEGRATION-LIKE TESTS (Pure Functions)
// --------------------------------------------------------

describe("Sync Fork Workflow Integration", () => {
  function createMockCommit(overrides: Partial<ParsedCommit> = {}): ParsedCommit {
    return {
      sha: "abc123def456",
      shortSha: "abc123d",
      type: "feat",
      subject: "Add new feature",
      author: "Test Author",
      date: "2024-01-01T00:00:00Z",
      files: [],
      isBreaking: false,
      isMerge: false,
      ...overrides,
    }
  }

  describe("State + Analysis workflow", () => {
    test("should track new commits and filter already processed", () => {
      const state = createDefaultState()

      // Simulate processing some commits
      const allCommits = [
        createMockCommit({ sha: "commit1" }),
        createMockCommit({ sha: "commit2" }),
        createMockCommit({ sha: "commit3" }),
      ]

      // Mark first two as processed
      markCommitAsSynced(state, "commit1", "PR-1")
      markCommitAsSkipped(state, "commit2", "Not relevant")

      // Get new commits
      const newShas = getNewCommits(
        state,
        allCommits.map((c) => c.sha)
      )

      expect(newShas).toEqual(["commit3"])
    })

    test("should correctly prioritize security commits in workflow", () => {
      const commits = [
        createMockCommit({ sha: "c1", type: "feat", subject: "Add feature" }),
        createMockCommit({ sha: "c2", type: "security", subject: "Fix vulnerability" }),
        createMockCommit({ sha: "c3", type: "docs", subject: "Update README" }),
      ]

      const priorities = commits.map((c) => ({
        sha: c.sha,
        priority: suggestPriority(c),
      }))

      expect(priorities.find((p) => p.sha === "c2")?.priority).toBe("P0")
      expect(priorities.find((p) => p.sha === "c1")?.priority).toBe("P2")
      expect(priorities.find((p) => p.sha === "c3")?.priority).toBe("P3")
    })

    test("should create fallback analysis for all commit types", () => {
      const commitTypes = ["feat", "fix", "perf", "security", "docs", "test", "chore", "refactor", "other"] as const

      for (const type of commitTypes) {
        const commit = createMockCommit({ type, sha: `sha-${type}` })
        const analysis = createFallbackAnalysis(commit)

        expect(analysis.commitSha).toBe(`sha-${type}`)
        expect(["P0", "P1", "P2", "P3", "Skip"]).toContain(analysis.priority)
        expect(analysis.reasoning).toBeTruthy()
      }
    })
  })

  describe("Grouping + Priority workflow", () => {
    test("should group and sort by priority correctly", () => {
      const commits = [
        // P3 - docs
        createMockCommit({ sha: "d1", type: "docs", scope: "readme" }),
        // P0 - security
        createMockCommit({ sha: "s1", type: "security", scope: "auth" }),
        // P2 - feat
        createMockCommit({ sha: "f1", type: "feat", scope: "api" }),
        // P1 - fix
        createMockCommit({ sha: "x1", type: "fix", scope: "core" }),
      ]

      const groups = groupCommitsByScope(commits)

      // Should be sorted: P0 (security) -> P1 (fix) -> P2 (feat) -> P3 (docs)
      expect(groups[0].commits[0].type).toBe("security")
      expect(groups[1].commits[0].type).toBe("fix")
      expect(groups[2].commits[0].type).toBe("feat")
      expect(groups[3].commits[0].type).toBe("docs")
    })
  })
})
