import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearBoulderState, readBoulderState, writeBoulderState } from "../../features/boulder-state"
import { registerAgentName, _resetForTesting as resetAgentState } from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

const { createAtlasHook } = await import("./index")

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }).trim()
}

describe("atlas hook idle-completion-nudge worktree guard", () => {
  let testDirectory = ""
  let repoRoot = ""
  let worktreePath = ""

  beforeEach(() => {
    resetAgentState()
    registerAgentName("atlas")
    testDirectory = join(tmpdir(), `atlas-worktree-guard-${randomUUID()}`)
    if (!existsSync(testDirectory)) {
      mkdirSync(testDirectory, { recursive: true })
    }
    clearBoulderState(testDirectory)
  })

  afterEach(() => {
    clearBoulderState(testDirectory)
    resetAgentState()
    if (worktreePath && existsSync(worktreePath)) {
      try {
        git(["worktree", "remove", "--force", worktreePath], repoRoot || testDirectory)
      } catch {
        rmSync(worktreePath, { recursive: true, force: true })
      }
    }
    if (repoRoot && existsSync(repoRoot)) {
      rmSync(repoRoot, { recursive: true, force: true })
    }
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  function setupRealGitRepoWithWorktree(): void {
    repoRoot = join(tmpdir(), `atlas-worktree-repo-${randomUUID()}`)
    mkdirSync(repoRoot, { recursive: true })
    git(["init", "--initial-branch=main"], repoRoot)
    git(["config", "user.email", "test@example.com"], repoRoot)
    git(["config", "user.name", "Test"], repoRoot)
    writeFileSync(join(repoRoot, "baseline.txt"), "baseline\n", "utf-8")
    // Ignore .omo/* (except .omo/rules/) so ignored OMO state in worktrees is realistic.
    writeFileSync(join(repoRoot, ".gitignore"), ".omo/*\n!.omo/rules/\n", "utf-8")
    git(["add", "baseline.txt", ".gitignore"], repoRoot)
    git(["commit", "-m", "baseline"], repoRoot)

    worktreePath = join(tmpdir(), `atlas-worktree-wt-${randomUUID()}`)
    // Create a new branch from main's commit so the worktree HEAD matches main
    // without conflicting with main being checked out in repoRoot.
    const mainCommit = git(["rev-parse", "main"], repoRoot)
    git(["worktree", "add", "-b", "worktree-branch", worktreePath, mainCommit], repoRoot)
  }

  function writePlanAndBoulderState(sessionID: string, planName: string, workId: string, wtPath?: string): string {
    const planPath = join(testDirectory, `${planName}.md`)
    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [x] 1. Done\n", "utf-8")
    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: workId,
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00.000Z",
      session_ids: [sessionID],
      plan_name: planName,
      ...(wtPath ? { worktree_path: wtPath } : {}),
      works: {
        [workId]: {
          work_id: workId,
          active_plan: planPath,
          plan_name: planName,
          started_at: "2026-01-02T10:00:00.000Z",
          session_ids: [sessionID],
          status: "active",
          ...(wtPath ? { worktree_path: wtPath } : {}),
        },
      },
    })
    return planPath
  }

  function createHookWithCapturedPrompt(sessionID: string): { hook: ReturnType<typeof createAtlasHook>; capturedPrompt: { text: string } } {
    const capturedPrompt = { text: "" }
    const hook = createAtlasHook(unsafeTestValue<Parameters<typeof createAtlasHook>[0]>({
      directory: testDirectory,
      client: {
        session: {
          get: async () => ({ data: { id: sessionID } }),
          messages: async () => ({ data: [] }),
          prompt: async (input: { body?: { parts?: Array<{ type?: string; text?: string }> } }) => {
            const text = input?.body?.parts?.find((p) => p?.type === "text")?.text
            if (text) capturedPrompt.text = text
            return { data: {} }
          },
          promptAsync: async (input: { body?: { parts?: Array<{ type?: string; text?: string }> } }) => {
            const text = input?.body?.parts?.find((p) => p?.type === "text")?.text
            if (text) capturedPrompt.text = text
            return { data: {} }
          },
        },
      },
    }))
    return { hook, capturedPrompt }
  }

  it("HEAD==main with dirty worktree → nudge contains WORKTREE LIFECYCLE: DIRTY and untracked file path; work still completed", async () => {
    // given: real git repo + worktree where HEAD == main
    setupRealGitRepoWithWorktree()
    const sessionID = "ses_dirty"
    const workId = "work-dirty"
    writePlanAndBoulderState(sessionID, "dirty-plan", workId, worktreePath)

    // write a NEW untracked file inside the worktree (the local-only change)
    const untrackedFile = "local-only-change.txt"
    writeFileSync(join(worktreePath, untrackedFile), "uncommitted\n", "utf-8")

    const { hook, capturedPrompt } = createHookWithCapturedPrompt(sessionID)

    // when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then: nudge contains DIRTY lifecycle, git status, and the untracked file path
    expect(capturedPrompt.text).toContain("WORKTREE LIFECYCLE: DIRTY")
    expect(capturedPrompt.text).toContain("git status --short")
    expect(capturedPrompt.text).toContain(untrackedFile)

    // and: completeBoulder still ran — work status is "completed" (guard steers language, does not stall state)
    const work = readBoulderState(testDirectory)?.works?.[workId]
    expect(work?.status).toBe("completed")
  })

  it("clean worktree → nudge contains WORKTREE LIFECYCLE: CLEAN", async () => {
    // given: real git repo + clean worktree (no untracked files)
    setupRealGitRepoWithWorktree()
    const sessionID = "ses_clean"
    const workId = "work-clean"
    writePlanAndBoulderState(sessionID, "clean-plan", workId, worktreePath)

    const { hook, capturedPrompt } = createHookWithCapturedPrompt(sessionID)

    // when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then
    expect(capturedPrompt.text).toContain("WORKTREE LIFECYCLE: CLEAN")
    expect(capturedPrompt.text).not.toContain("WORKTREE LIFECYCLE: DIRTY")
  })

  it("no worktree_path set → nudge has no WORKTREE LIFECYCLE line", async () => {
    // given: no worktree_path in boulder state
    const sessionID = "ses_no_wt"
    const workId = "work-no-wt"
    writePlanAndBoulderState(sessionID, "no-wt-plan", workId)

    const { hook, capturedPrompt } = createHookWithCapturedPrompt(sessionID)

    // when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then: no WORKTREE LIFECYCLE line at all (blank line only from the placeholder)
    expect(capturedPrompt.text).not.toContain("WORKTREE LIFECYCLE")
  })

  it("HEAD==main with only ignored .omo state → nudge contains WORKTREE LIFECYCLE: DIRTY and ignored .omo paths", async () => {
    // given: real git repo + worktree where HEAD == main, plain status empty, only ignored .omo files present
    setupRealGitRepoWithWorktree()
    // Write ignored OMO state inside the worktree (.omo/* is ignored in the baseline commit)
    const omoDir = join(worktreePath, ".omo", "start-work")
    mkdirSync(omoDir, { recursive: true })
    const ledgerFile = "ledger.jsonl"
    writeFileSync(join(omoDir, ledgerFile), '{"event":"task-completed"}\n', "utf-8")

    const sessionID = "ses_omo"
    const workId = "work-omo"
    writePlanAndBoulderState(sessionID, "omo-plan", workId, worktreePath)

    const { hook, capturedPrompt } = createHookWithCapturedPrompt(sessionID)

    // when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then: nudge contains DIRTY lifecycle (not CLEAN), the ignored .omo section, and the .omo path
    expect(capturedPrompt.text).toContain("WORKTREE LIFECYCLE: DIRTY")
    expect(capturedPrompt.text).toContain("git status --short --ignored -- .omo")
    expect(capturedPrompt.text).toContain("!! .omo/")
    expect(capturedPrompt.text).not.toContain("WORKTREE LIFECYCLE: CLEAN")

    // and: completeBoulder still ran — work status is "completed"
    const work = readBoulderState(testDirectory)?.works?.[workId]
    expect(work?.status).toBe("completed")
  })

  it("worktree_path points to removed/non-git path → nudge contains WORKTREE LIFECYCLE: UNKNOWN", async () => {
    // given: worktree_path points to a path that does not exist
    const sessionID = "ses_unknown"
    const workId = "work-unknown"
    const fakePath = join(tmpdir(), `atlas-nonexistent-${randomUUID()}`)
    writePlanAndBoulderState(sessionID, "unknown-plan", workId, fakePath)

    const { hook, capturedPrompt } = createHookWithCapturedPrompt(sessionID)

    // when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then: git status failure is rendered as UNKNOWN, never CLEAN
    expect(capturedPrompt.text).toContain("WORKTREE LIFECYCLE: UNKNOWN")
    expect(capturedPrompt.text).toContain("inspect the worktree manually")
    expect(capturedPrompt.text).not.toContain("WORKTREE LIFECYCLE: CLEAN")
  })
})
