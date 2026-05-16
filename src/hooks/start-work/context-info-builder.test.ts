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

    const workAId = initialState.active_work_id!
    const withSecondWork = addBoulderWork(testDirectory, {
      planPath: workBPath,
      sessionId: "session-b",
      agent: "atlas",
      worktreePath: "/tmp/worktree-b",
    })
    expect(withSecondWork).not.toBeNull()
    const workBId = Object.keys(withSecondWork!.works!).find((workId) => workId !== workAId)
    expect(workBId).toBeDefined()

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
    expect(workIds).toContain(workBId!)
    const workC = getWorkByPlanName(testDirectory, "new-plan-c")
    expect(workC).not.toBeNull()
    expect(workIds).toContain(workC!.work_id)
  })
})
