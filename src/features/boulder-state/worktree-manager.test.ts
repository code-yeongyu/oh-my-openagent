/**
 * Worktree Manager Tests (Task 10.3)
 *
 * Tests for wave worktree auto-management functionality.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import {
  findOrCreateWorktreeDir,
  ensureGitignored,
  initializeWaveExecution,
  createWaveWorktree,
  createAllWaveWorktrees,
  updateWaveStatus,
  recordTaskCompletion,
  cleanupWaveWorktree,
  cleanupAllWaveWorktrees,
  getWaveExecutionSummary,
  hasActiveWaveExecution,
  getWaveWorktreePath,
  listGitWorktrees,
  pruneWorktrees,
} from "./worktree-manager"
import { writeBoulderState, readBoulderState } from "./storage"
import type { BoulderState } from "./types"
import type { Wave } from "../../shared/wave-grouper"

const TEST_DIR = join(process.cwd(), ".test-worktree-manager")

function createTestGitRepo(): void {
  mkdirSync(TEST_DIR, { recursive: true })
  execSync("git init", { cwd: TEST_DIR, stdio: "pipe" })
  execSync('git config user.email "test@test.com"', { cwd: TEST_DIR, stdio: "pipe" })
  execSync('git config user.name "Test"', { cwd: TEST_DIR, stdio: "pipe" })
  writeFileSync(join(TEST_DIR, "README.md"), "# Test\n")
  execSync("git add .", { cwd: TEST_DIR, stdio: "pipe" })
  execSync('git commit -m "Initial commit"', { cwd: TEST_DIR, stdio: "pipe" })
}

function cleanupTestDir(): void {
  if (existsSync(TEST_DIR)) {
    // Clean up any worktrees first
    try {
      execSync("git worktree prune", { cwd: TEST_DIR, stdio: "pipe" })
      const worktrees = execSync("git worktree list --porcelain", { cwd: TEST_DIR, encoding: "utf-8" })
      for (const line of worktrees.split("\n")) {
        if (line.startsWith("worktree ") && !line.includes(TEST_DIR + "\n")) {
          const path = line.substring(9)
          if (path !== TEST_DIR) {
            try {
              execSync(`git worktree remove "${path}" --force`, { cwd: TEST_DIR, stdio: "pipe" })
            } catch {
              // Ignore errors
            }
          }
        }
      }
    } catch {
      // Ignore errors during cleanup
    }
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function createBaseBoulderState(): BoulderState {
  return {
    active_plan: join(TEST_DIR, "changes/test-plan/tasks.md"),
    started_at: new Date().toISOString(),
    session_ids: ["test-session"],
    plan_name: "test-plan",
    phase: "executing",
    last_updated: new Date().toISOString(),
  }
}

function createTestWaves(): Wave[] {
  return [
    {
      id: 0,
      tasks: [
        { id: "1.1", dependsOn: [], files: { create: ["src/a.ts"], modify: [], test: [] } },
        { id: "1.2", dependsOn: [], files: { create: ["src/b.ts"], modify: [], test: [] } },
      ],
      worktreeBranch: "feature/test-feature-wave0",
    },
    {
      id: 1,
      tasks: [
        { id: "2.1", dependsOn: ["1.1"], files: { create: [], modify: ["src/a.ts"], test: [] } },
      ],
      worktreeBranch: "feature/test-feature-wave1",
    },
  ]
}

describe("worktree-manager", () => {
  beforeEach(() => {
    cleanupTestDir()
    createTestGitRepo()
  })

  afterEach(() => {
    cleanupTestDir()
  })

  describe("findOrCreateWorktreeDir", () => {
    test("creates .worktrees directory if none exists", () => {
      // #given no worktree directory exists
      // #when findOrCreateWorktreeDir is called
      const result = findOrCreateWorktreeDir(TEST_DIR)

      // #then .worktrees directory should be created
      expect(result).toBe(join(TEST_DIR, ".worktrees"))
      expect(existsSync(join(TEST_DIR, ".worktrees"))).toBe(true)
    })

    test("returns existing .worktrees if present", () => {
      // #given .worktrees directory already exists
      mkdirSync(join(TEST_DIR, ".worktrees"), { recursive: true })

      // #when findOrCreateWorktreeDir is called
      const result = findOrCreateWorktreeDir(TEST_DIR)

      // #then existing directory should be returned
      expect(result).toBe(join(TEST_DIR, ".worktrees"))
    })

    test("returns existing worktrees (visible) if present and no hidden", () => {
      // #given only visible worktrees directory exists
      mkdirSync(join(TEST_DIR, "worktrees"), { recursive: true })

      // #when findOrCreateWorktreeDir is called
      const result = findOrCreateWorktreeDir(TEST_DIR)

      // #then visible directory should be returned
      expect(result).toBe(join(TEST_DIR, "worktrees"))
    })

    test("prefers .worktrees over worktrees when both exist", () => {
      // #given both directories exist
      mkdirSync(join(TEST_DIR, ".worktrees"), { recursive: true })
      mkdirSync(join(TEST_DIR, "worktrees"), { recursive: true })

      // #when findOrCreateWorktreeDir is called
      const result = findOrCreateWorktreeDir(TEST_DIR)

      // #then hidden directory should be preferred
      expect(result).toBe(join(TEST_DIR, ".worktrees"))
    })
  })

  describe("ensureGitignored", () => {
    test("adds entry to new .gitignore", () => {
      // #given no .gitignore exists
      // #when ensureGitignored is called
      const result = ensureGitignored(TEST_DIR, ".worktrees/")

      // #then entry should be added
      expect(result).toBe(true)
      const content = readFileSync(join(TEST_DIR, ".gitignore"), "utf-8")
      expect(content).toContain(".worktrees/")
    })

    test("adds entry to existing .gitignore", () => {
      // #given .gitignore exists with other content
      writeFileSync(join(TEST_DIR, ".gitignore"), "node_modules/\n")

      // #when ensureGitignored is called
      const result = ensureGitignored(TEST_DIR, ".worktrees/")

      // #then entry should be appended
      expect(result).toBe(true)
      const content = readFileSync(join(TEST_DIR, ".gitignore"), "utf-8")
      expect(content).toContain("node_modules/")
      expect(content).toContain(".worktrees/")
    })

    test("does not duplicate entry if already present", () => {
      // #given .gitignore already contains entry
      writeFileSync(join(TEST_DIR, ".gitignore"), ".worktrees/\n")

      // #when ensureGitignored is called
      const result = ensureGitignored(TEST_DIR, ".worktrees/")

      // #then no duplicate should be added
      expect(result).toBe(true)
      const content = readFileSync(join(TEST_DIR, ".gitignore"), "utf-8")
      const matches = content.match(/\.worktrees\//g)
      expect(matches?.length).toBe(1)
    })
  })

  describe("initializeWaveExecution", () => {
    test("creates wave execution state with worktrees", () => {
      // #given boulder state exists
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      const waves = createTestWaves()

      // #when initializeWaveExecution is called
      const result = initializeWaveExecution(TEST_DIR, "test-feature", waves, "parallel")

      // #then wave execution state should be created
      expect(result).not.toBeNull()
      expect(result?.featureName).toBe("test-feature")
      expect(result?.mode).toBe("parallel")
      expect(result?.waves.length).toBe(2)
      expect(result?.waves[0].waveId).toBe(0)
      expect(result?.waves[0].status).toBe("pending")
      expect(result?.waves[0].taskIds).toEqual(["1.1", "1.2"])
      expect(result?.waves[1].waveId).toBe(1)
      expect(result?.waves[1].taskIds).toEqual(["2.1"])
    })

    test("persists wave execution state to boulder state", () => {
      // #given boulder state exists
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      const waves = createTestWaves()

      // #when initializeWaveExecution is called
      initializeWaveExecution(TEST_DIR, "test-feature", waves)

      // #then state should be persisted
      const state = readBoulderState(TEST_DIR)
      expect(state?.wave_execution).not.toBeNull()
      expect(state?.wave_execution?.featureName).toBe("test-feature")
    })
  })

  describe("createWaveWorktree", () => {
    test("creates git worktree for pending wave", () => {
      // #given wave execution is initialized
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      const waves = createTestWaves()
      initializeWaveExecution(TEST_DIR, "test-feature", waves)

      // #when createWaveWorktree is called
      const result = createWaveWorktree(TEST_DIR, 0)

      // #then worktree should be created
      expect(result.success).toBe(true)
      expect(result.path).toBeDefined()
      expect(existsSync(result.path!)).toBe(true)

      // #then wave status should be updated
      const state = readBoulderState(TEST_DIR)
      expect(state?.wave_execution?.waves[0].status).toBe("ready")
    })

    test("fails for non-existent wave", () => {
      // #given wave execution is initialized
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      const waves = createTestWaves()
      initializeWaveExecution(TEST_DIR, "test-feature", waves)

      // #when createWaveWorktree is called for non-existent wave
      const result = createWaveWorktree(TEST_DIR, 99)

      // #then should fail
      expect(result.success).toBe(false)
      expect(result.error).toContain("not found")
    })
  })

  describe("updateWaveStatus", () => {
    test("updates wave status and SHAs", () => {
      // #given wave execution exists
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      initializeWaveExecution(TEST_DIR, "test-feature", createTestWaves())

      // #when updateWaveStatus is called
      const result = updateWaveStatus(TEST_DIR, 0, "completed", { "1.1": "abc123", "1.2": "def456" })

      // #then status should be updated
      expect(result).toBe(true)
      const state = readBoulderState(TEST_DIR)
      expect(state?.wave_execution?.waves[0].status).toBe("completed")
      expect(state?.wave_execution?.waves[0].completedShas?.["1.1"]).toBe("abc123")
    })
  })

  describe("recordTaskCompletion", () => {
    test("records task SHA in wave", () => {
      // #given wave execution exists
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      initializeWaveExecution(TEST_DIR, "test-feature", createTestWaves())

      // #when recordTaskCompletion is called
      const result = recordTaskCompletion(TEST_DIR, 0, "1.1", "sha123")

      // #then SHA should be recorded
      expect(result).toBe(true)
      const state = readBoulderState(TEST_DIR)
      expect(state?.wave_execution?.waves[0].completedShas?.["1.1"]).toBe("sha123")
    })
  })

  describe("getWaveExecutionSummary", () => {
    test("returns correct counts for wave statuses", () => {
      // #given wave execution with mixed statuses
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      initializeWaveExecution(TEST_DIR, "test-feature", createTestWaves())
      updateWaveStatus(TEST_DIR, 0, "completed")

      // #when getWaveExecutionSummary is called
      const summary = getWaveExecutionSummary(TEST_DIR)

      // #then correct counts should be returned
      expect(summary).not.toBeNull()
      expect(summary?.totalWaves).toBe(2)
      expect(summary?.completed).toBe(1)
      expect(summary?.pending).toBe(1)
    })
  })

  describe("hasActiveWaveExecution", () => {
    test("returns true when waves are pending", () => {
      // #given wave execution with pending waves
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      initializeWaveExecution(TEST_DIR, "test-feature", createTestWaves())

      // #when hasActiveWaveExecution is called
      const result = hasActiveWaveExecution(TEST_DIR)

      // #then should return true
      expect(result).toBe(true)
    })

    test("returns false when all waves completed", () => {
      // #given all waves are completed
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      initializeWaveExecution(TEST_DIR, "test-feature", createTestWaves())
      updateWaveStatus(TEST_DIR, 0, "completed")
      updateWaveStatus(TEST_DIR, 1, "completed")

      // #when hasActiveWaveExecution is called
      const result = hasActiveWaveExecution(TEST_DIR)

      // #then should return false
      expect(result).toBe(false)
    })
  })

  describe("getWaveWorktreePath", () => {
    test("returns path for existing wave", () => {
      // #given wave execution exists
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      initializeWaveExecution(TEST_DIR, "test-feature", createTestWaves())

      // #when getWaveWorktreePath is called
      const path = getWaveWorktreePath(TEST_DIR, 0)

      // #then path should be returned
      expect(path).toContain("test-feature-wave0")
    })

    test("returns null for non-existent wave", () => {
      // #given wave execution exists
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      initializeWaveExecution(TEST_DIR, "test-feature", createTestWaves())

      // #when getWaveWorktreePath is called for non-existent wave
      const path = getWaveWorktreePath(TEST_DIR, 99)

      // #then null should be returned
      expect(path).toBeNull()
    })
  })

  describe("listGitWorktrees", () => {
    test("lists main worktree", () => {
      // #given a git repo exists
      // #when listGitWorktrees is called
      const worktrees = listGitWorktrees(TEST_DIR)

      // #then main worktree should be listed
      expect(worktrees.length).toBeGreaterThanOrEqual(1)
      // Normalize path separators for cross-platform compatibility
      const normalizedPath = worktrees[0].path.replace(/\//g, "\\")
      const normalizedTestDir = TEST_DIR.replace(/\//g, "\\")
      expect(normalizedPath).toBe(normalizedTestDir)
    })
  })

  describe("pruneWorktrees", () => {
    test("prunes successfully on clean repo", () => {
      // #given a git repo
      // #when pruneWorktrees is called
      const result = pruneWorktrees(TEST_DIR)

      // #then should succeed
      expect(result).toBe(true)
    })
  })

  describe("cleanupWaveWorktree", () => {
    test("cleans up created worktree", () => {
      // #given worktree was created
      const boulderState = createBaseBoulderState()
      writeBoulderState(TEST_DIR, boulderState)
      initializeWaveExecution(TEST_DIR, "test-feature", createTestWaves())
      const createResult = createWaveWorktree(TEST_DIR, 0)
      expect(createResult.success).toBe(true)

      // #when cleanupWaveWorktree is called
      const result = cleanupWaveWorktree(TEST_DIR, 0)

      // #then worktree should be removed
      expect(result.success).toBe(true)
      expect(existsSync(createResult.path!)).toBe(false)

      // #then status should be updated
      const state = readBoulderState(TEST_DIR)
      expect(state?.wave_execution?.waves[0].status).toBe("cleaned")
    })
  })
})
