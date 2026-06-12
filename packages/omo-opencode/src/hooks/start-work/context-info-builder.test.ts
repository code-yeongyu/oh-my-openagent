/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildStartWorkContextInfo } from "./context-info-builder"
import {
  addBoulderWork,
  createBoulderState,
  getBoulderFilePath,
  getWorkByPlanName,
  readBoulderState,
  selectActiveWork,
  writeBoulderState,
} from "../../features/boulder-state"
import * as boulderState from "../../features/boulder-state"

describe("buildStartWorkContextInfo", () => {
  let testDirectory = ""

  function createPluginInput() {
    return {
      directory: testDirectory,
    } as never
  }

  function writePlan(planName: string, content: string): string {
    const plansDirectory = join(testDirectory, ".omo", "plans")
    mkdirSync(plansDirectory, { recursive: true })
    const planPath = join(plansDirectory, `${planName}.md`)
    writeFileSync(planPath, content)
    return planPath
  }

  function readExistingState() {
    return readBoulderState(testDirectory)
  }

  beforeEach(() => {
    testDirectory = join(tmpdir(), `context-info-builder-${randomUUID()}`)
    mkdirSync(testDirectory, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  test("lists multiple active works and asks agent to choose resume vs new when no explicit plan", () => {
    // given
    const clearSpy = spyOn(boulderState, "clearBoulderState")
    const planAPath = writePlan("plan-alpha", "## TODOs\n- [ ] 1. Alpha")
    const planBPath = writePlan("plan-beta", "## TODOs\n- [ ] 1. Beta")
    const initialState = createBoulderState(planAPath, "session-a", "atlas", "/tmp/worktree-a")
    writeBoulderState(testDirectory, initialState)
    addBoulderWork(testDirectory, {
      planPath: planBPath,
      sessionId: "session-b",
      agent: "atlas",
      worktreePath: "/tmp/worktree-b",
    })

    // when
    const contextInfo = buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: null,
      existingState: readExistingState(),
      sessionId: "session-current",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: undefined,
      worktreeBlock: "",
    })

    // then
    expect(contextInfo).toContain("plan-alpha")
    expect(contextInfo).toContain("plan-beta")
    expect(contextInfo).toContain("Use the Question tool")
    expect(clearSpy).toHaveBeenCalledTimes(0)
  })

  test("auto-resumes when exactly one active work exists and no explicit plan", () => {
    // given
    const clearSpy = spyOn(boulderState, "clearBoulderState")
    const planPath = writePlan("single-active-plan", "## TODOs\n- [ ] 1. Single task")
    const initialState = createBoulderState(planPath, "session-a", "atlas", "/tmp/worktree-single")
    writeBoulderState(testDirectory, initialState)

    // when
    const contextInfo = buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: null,
      existingState: readExistingState(),
      sessionId: "session-current",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: undefined,
      worktreeBlock: "",
    })

    // then
    expect(contextInfo).toContain("RESUMING existing work")
    expect(contextInfo).toContain("single-active-plan")
    expect(contextInfo).not.toContain("Use the Question tool")
    expect(clearSpy).toHaveBeenCalledTimes(0)
  })

  test("explicit plan selects matching work only and never clears boulder state", () => {
    // given
    const clearSpy = spyOn(boulderState, "clearBoulderState")
    const planAPath = writePlan("explicit-plan-a", "## TODOs\n- [ ] 1. A")
    const planBPath = writePlan("explicit-plan-b", "## TODOs\n- [ ] 1. B")
    const initialState = createBoulderState(planAPath, "session-a", "atlas", "/tmp/worktree-a")
    writeBoulderState(testDirectory, initialState)
    addBoulderWork(testDirectory, {
      planPath: planBPath,
      sessionId: "session-b",
      agent: "atlas",
      worktreePath: "/tmp/worktree-b",
    })

    // when
    const contextInfo = buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: "explicit-plan-a",
      existingState: readExistingState(),
      sessionId: "session-current",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: "/tmp/worktree-a",
      worktreeBlock: "",
    })

    // then
    expect(contextInfo).toContain("explicit-plan-a")
    expect(contextInfo).not.toContain("explicit-plan-b")
    expect(clearSpy).toHaveBeenCalledTimes(0)

    const selectedWork = getWorkByPlanName(testDirectory, "explicit-plan-a", { worktreePath: "/tmp/worktree-a" })
    const nextState = readBoulderState(testDirectory)
    expect(selectedWork).not.toBeNull()
    expect(nextState?.active_work_id).toBe(selectedWork?.work_id)
  })

  test("falls back to auto-select latest plan when no works exist", () => {
    // given
    const clearSpy = spyOn(boulderState, "clearBoulderState")
    const coldStartPlanPath = writePlan("cold-start-plan", "## TODOs\n- [ ] 1. Cold start")

    // when
    const contextInfo = buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: null,
      existingState: null,
      sessionId: "session-current",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: undefined,
      worktreeBlock: "",
    })

    // then
    expect(contextInfo).toContain("Auto-Selected Plan")
    expect(contextInfo).toContain("cold-start-plan")
    expect(contextInfo).toContain(coldStartPlanPath)
    expect(existsSync(getBoulderFilePath(testDirectory))).toBe(true)
    expect(clearSpy).toHaveBeenCalledTimes(0)
  })

  test("#given multiple incomplete plans and a preferred session plan #when no work exists #then preferred plan is started", () => {
    // given
    const ignoredPlanPath = writePlan("ignored-plan", "## TODOs\n- [ ] 1. Ignored")
    const preferredPlanPath = writePlan("preferred-plan", "## TODOs\n- [ ] 1. Preferred")

    // when
    const contextInfo = buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: null,
      existingState: null,
      sessionId: "session-current",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: "/tmp/preferred-worktree",
      worktreeBlock: "## Worktree\n/tmp/preferred-worktree",
      preferredPlanPath,
    })

    // then
    expect(contextInfo).toContain("Auto-Selected Plan")
    expect(contextInfo).toContain("preferred-plan")
    expect(contextInfo).toContain(preferredPlanPath)
    expect(contextInfo).toContain("Most recently referenced plan in this session")
    expect(contextInfo).not.toContain(ignoredPlanPath)

    const nextState = readBoulderState(testDirectory)
    expect(nextState?.active_plan).toBe(preferredPlanPath)
    expect(nextState?.session_ids).toEqual(["opencode:session-current"])
    expect(nextState?.agent).toBe("atlas")
    expect(nextState?.worktree_path).toBe("/tmp/preferred-worktree")
  })

  test("#given existing active state with stale agent and worktree #when resuming #then state is rewritten for current session", () => {
    // given
    const planPath = writePlan("resume-existing-plan", "## TODOs\n- [ ] 1. Continue")
    const initialState = createBoulderState(planPath, "session-old", "sisyphus", "/tmp/old-worktree")
    writeBoulderState(testDirectory, initialState)

    // when
    const contextInfo = buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: null,
      existingState: readExistingState(),
      sessionId: "session-current",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: "/tmp/new-worktree",
      worktreeBlock: "## Worktree\n/tmp/new-worktree",
    })

    // then
    expect(contextInfo).toContain("RESUMING existing work")
    expect(contextInfo).toContain("resume-existing-plan")
    expect(contextInfo).toContain("## Worktree\n/tmp/new-worktree")
    expect(contextInfo).toContain("session-current")

    const nextState = readBoulderState(testDirectory)
    expect(nextState?.agent).toBe("atlas")
    expect(nextState?.worktree_path).toBe("/tmp/new-worktree")
    expect(nextState?.session_ids).toEqual(["opencode:session-old", "opencode:session-current"])
  })

  test("#given explicit completed work matches #when starting that plan #then active work remains unchanged", () => {
    // given
    const activePlanPath = writePlan("active-plan", "## TODOs\n- [ ] 1. Continue")
    const completedPlanPath = writePlan("completed-plan", "## TODOs\n- [x] 1. Done")
    const initialState = createBoulderState(activePlanPath, "session-active", "atlas", undefined)
    writeBoulderState(testDirectory, initialState)
    const completedState = addBoulderWork(testDirectory, {
      planPath: completedPlanPath,
      sessionId: "session-completed",
      agent: "atlas",
      worktreePath: undefined,
    })
    if (!completedState?.active_work_id) {
      throw new Error("expected completed work to be added")
    }
    const activeWorkId = initialState.active_work_id
    if (!activeWorkId) {
      throw new Error("expected initial active work id")
    }
    const completedWorkId = completedState.active_work_id
    selectActiveWork(testDirectory, activeWorkId)

    // when
    const contextInfo = buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: "completed-plan",
      existingState: readExistingState(),
      sessionId: "session-current",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: undefined,
      worktreeBlock: "",
    })

    // then
    expect(contextInfo).toContain("Plan Already Complete")
    expect(contextInfo).toContain("completed-plan")
    const nextState = readBoulderState(testDirectory)
    expect(nextState?.active_work_id).toBe(activeWorkId)
    expect(nextState?.active_work_id).not.toBe(completedWorkId)
  })

  test("#given one active work and stale preferred plan #when starting work #then active work resumes", () => {
    // given
    const activePlanPath = writePlan("single-active-plan", "## TODOs\n- [ ] 1. Continue")
    const stalePreferredPlanPath = join(testDirectory, ".omo", "plans", "missing-plan.md")
    const initialState = createBoulderState(activePlanPath, "session-active", "atlas", undefined)
    writeBoulderState(testDirectory, initialState)

    // when
    const contextInfo = buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: null,
      existingState: readExistingState(),
      sessionId: "session-current",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: undefined,
      worktreeBlock: "",
      preferredPlanPath: stalePreferredPlanPath,
    })

    // then
    expect(contextInfo).toContain("RESUMING existing work")
    expect(contextInfo).toContain("single-active-plan")
    expect(contextInfo).not.toContain("No Plans Found")
    expect(contextInfo).not.toContain("Auto-Selected Plan")
    expect(readBoulderState(testDirectory)?.active_plan).toBe(activePlanPath)
  })

  test("auto-selects the only incomplete plan when explicit plan name misses", () => {
    // given
    const clearSpy = spyOn(boulderState, "clearBoulderState")
    const actualPlanPath = writePlan("full-site-audit-fix-plan", "## TODOs\n- [ ] 1. Fix audit findings")

    // when
    const contextInfo = buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: "mot-vat-notifications-plan",
      existingState: null,
      sessionId: "session-current",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: undefined,
      worktreeBlock: "",
    })

    // then
    expect(contextInfo).toContain("Auto-Selected Plan")
    expect(contextInfo).toContain("full-site-audit-fix-plan")
    expect(contextInfo).toContain(actualPlanPath)
    expect(contextInfo).toContain("Only incomplete plan available")
    expect(contextInfo).not.toContain("Plan Not Found")
    expect(existsSync(getBoulderFilePath(testDirectory))).toBe(true)
    expect(clearSpy).toHaveBeenCalledTimes(0)
  })

  test("asks for selection when explicit plan name misses with multiple incomplete plans", () => {
    // given
    const clearSpy = spyOn(boulderState, "clearBoulderState")
    writePlan("first-candidate-plan", "## TODOs\n- [ ] 1. First task")
    writePlan("second-candidate-plan", "## TODOs\n- [ ] 1. Second task")

    // when
    const contextInfo = buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: "unmatched-plan",
      existingState: null,
      sessionId: "session-current",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: undefined,
      worktreeBlock: "",
    })

    // then
    expect(contextInfo).toContain("Plan Not Found")
    expect(contextInfo).toContain("first-candidate-plan")
    expect(contextInfo).toContain("second-candidate-plan")
    expect(contextInfo).toContain("Ask the user which plan to work on")
    expect(existsSync(getBoulderFilePath(testDirectory))).toBe(false)
    expect(clearSpy).toHaveBeenCalledTimes(0)
  })

  test("keeps existing works when explicit new plan is started", () => {
    // given
    writePlan("work-a", "## TODOs\n- [ ] 1. Work A")
    const workBPath = writePlan("work-b", "## TODOs\n- [ ] 1. Work B")
    writePlan("new-plan-c", "## TODOs\n- [ ] 1. Work C")

    const initialState = createBoulderState(
      join(testDirectory, ".omo", "plans", "work-a.md"),
      "session-a",
      "atlas",
      "/tmp/worktree-a",
    )
    writeBoulderState(testDirectory, initialState)

    const workAId = initialState.active_work_id
    if (!workAId) {
      throw new Error("expected initial state to include active work id")
    }
    const withSecondWork = addBoulderWork(testDirectory, {
      planPath: workBPath,
      sessionId: "session-b",
      agent: "atlas",
      worktreePath: "/tmp/worktree-b",
    })
    if (!withSecondWork?.works) {
      throw new Error("expected second work to be added")
    }
    const workBId = Object.keys(withSecondWork.works).find((workId) => workId !== workAId)
    if (!workBId) {
      throw new Error("expected second work id to be present")
    }

    // when
    buildStartWorkContextInfo({
      ctx: createPluginInput(),
      explicitPlanName: "new-plan-c",
      existingState: readExistingState(),
      sessionId: "session-c",
      timestamp: "2026-05-11T00:00:00.000Z",
      activeAgent: "atlas",
      worktreePath: undefined,
      worktreeBlock: "",
    })

    // then
    const nextState = readBoulderState(testDirectory)
    const workIds = Object.keys(nextState?.works ?? {})
    expect(workIds.length).toBe(3)
    expect(workIds).toContain(workAId)
    expect(workIds).toContain(workBId)
    const workC = getWorkByPlanName(testDirectory, "new-plan-c")
    if (!workC) {
      throw new Error("expected new plan work to be present")
    }
    expect(workIds).toContain(workC.work_id)
  })
})
