import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { clearBoulderState, writeBoulderState } from "../../features/boulder-state"
import { resolveActiveBoulderSession } from "./resolve-active-boulder-session"

describe("resolveActiveBoulderSession", () => {
  let testDirectory = ""

  beforeEach(() => {
    testDirectory = join(tmpdir(), `resolve-active-boulder-${randomUUID()}`)
    if (!existsSync(testDirectory)) {
      mkdirSync(testDirectory, { recursive: true })
    }
    clearBoulderState(testDirectory)
  })

  afterEach(() => {
    clearBoulderState(testDirectory)
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  test("returns null for unrelated session even when active boulder plan is complete", async () => {
    // given
    const planPath = join(testDirectory, "complete-plan.md")
    writeFileSync(planPath, "# Plan\n- [x] Task 1\n", "utf-8")
    writeBoulderState(testDirectory, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: ["ses_tracked"],
      session_origins: { ses_tracked: "direct" },
      plan_name: "complete-plan",
    })

    // when
    const result = await resolveActiveBoulderSession({
      client: { session: { get: async () => ({ data: {} }) } } as never,
      directory: testDirectory,
      sessionID: "ses_unrelated",
    })

    // then
    expect(result).toBeNull()
  })

  test("returns tracked direct session for incomplete boulder plan", async () => {
    // given
    const planPath = join(testDirectory, "incomplete-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n", "utf-8")
    writeBoulderState(testDirectory, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: ["ses_tracked"],
      session_origins: { ses_tracked: "direct" },
      plan_name: "incomplete-plan",
    })

    // when
    const result = await resolveActiveBoulderSession({
      client: { session: { get: async () => ({ data: {} }) } } as never,
      directory: testDirectory,
      sessionID: "ses_tracked",
    })

    // then
    expect(result).not.toBeNull()
    expect(result?.progress.isComplete).toBe(false)
    expect(result?.boulderState.session_ids).toContain("ses_tracked")
  })

  test("returns tracked appended session for incomplete boulder plan", async () => {
    // given
    const planPath = join(testDirectory, "appended-incomplete-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n", "utf-8")
    writeBoulderState(testDirectory, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: ["ses_root", "ses_appended"],
      session_origins: { ses_root: "direct", ses_appended: "appended" },
      plan_name: "appended-incomplete-plan",
    })

    // when
    const result = await resolveActiveBoulderSession({
      client: { session: { get: async () => ({ data: {} }) } } as never,
      directory: testDirectory,
      sessionID: "ses_appended",
    })

    // then
    expect(result).not.toBeNull()
    expect(result?.progress.isComplete).toBe(false)
    expect(result?.boulderState.session_ids).toContain("ses_appended")
  })

  test("returns complete progress when a mirrored worktree plan is complete", async () => {
    // given
    const mainPlanPath = join(testDirectory, ".omo", "plans", "worktree-plan.md")
    const worktreeDirectory = join(tmpdir(), `resolve-active-boulder-worktree-${randomUUID()}`)
    const worktreePlanPath = join(worktreeDirectory, ".omo", "plans", "worktree-plan.md")
    mkdirSync(dirname(mainPlanPath), { recursive: true })
    mkdirSync(dirname(worktreePlanPath), { recursive: true })
    writeFileSync(mainPlanPath, "# Plan\n- [ ] Main repo task\n", "utf-8")
    writeFileSync(worktreePlanPath, "# Plan\n- [x] Worktree task\n", "utf-8")
    writeBoulderState(testDirectory, {
      active_plan: mainPlanPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: ["ses_tracked"],
      session_origins: { ses_tracked: "direct" },
      plan_name: "worktree-plan",
      worktree_path: worktreeDirectory,
    })

    try {
      // when
      const result = await resolveActiveBoulderSession({
        client: { session: { get: async () => ({ data: {} }) } } as never,
        directory: testDirectory,
        sessionID: "ses_tracked",
      })

      // then
      expect(result).not.toBeNull()
      expect(result?.progress.isComplete).toBe(true)
      expect(result?.progress.completed).toBe(1)
    } finally {
      rmSync(worktreeDirectory, { recursive: true, force: true })
    }
  })

  test("uses work resolved by session id when works map is present", async () => {
    // given
    const legacyPlanPath = join(testDirectory, "legacy-plan.md")
    const workAPlanPath = join(testDirectory, "work-a-plan.md")
    const workBPlanPath = join(testDirectory, "work-b-plan.md")
    writeFileSync(legacyPlanPath, "# Plan\n- [ ] Legacy\n", "utf-8")
    writeFileSync(workAPlanPath, "# Plan\n- [ ] Work A\n", "utf-8")
    writeFileSync(workBPlanPath, "# Plan\n- [x] Work B\n", "utf-8")

    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: "work-a",
      active_plan: legacyPlanPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: ["ses_legacy"],
      plan_name: "legacy-plan",
      works: {
        "work-a": {
          work_id: "work-a",
          active_plan: workAPlanPath,
          plan_name: "work-a-plan",
          started_at: "2026-01-02T10:00:00Z",
          session_ids: ["ses_work_a"],
          status: "active",
        },
        "work-b": {
          work_id: "work-b",
          active_plan: workBPlanPath,
          plan_name: "work-b-plan",
          started_at: "2026-01-02T11:00:00Z",
          session_ids: ["ses_work_b"],
          status: "active",
        },
      },
    })

    // when
    const result = await resolveActiveBoulderSession({
      client: { session: { get: async () => ({ data: {} }) } } as never,
      directory: testDirectory,
      sessionID: "ses_work_b",
    })

    // then
    expect(result).not.toBeNull()
    expect(result?.boulderState.active_plan).toBe(workBPlanPath)
    expect(result?.progress.isComplete).toBe(true)
  })

  test("falls back to top-level mirror when works map is missing", async () => {
    // given
    const legacyPlanPath = join(testDirectory, "legacy-only-plan.md")
    writeFileSync(legacyPlanPath, "# Plan\n- [ ] Task 1\n", "utf-8")
    writeBoulderState(testDirectory, {
      active_plan: legacyPlanPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: ["ses_legacy_only"],
      plan_name: "legacy-only-plan",
    })

    // when
    const result = await resolveActiveBoulderSession({
      client: { session: { get: async () => ({ data: {} }) } } as never,
      directory: testDirectory,
      sessionID: "ses_legacy_only",
    })

    // then
    expect(result).not.toBeNull()
    expect(result?.boulderState.active_plan).toBe(legacyPlanPath)
    expect(result?.progress.isComplete).toBe(false)
  })
})
