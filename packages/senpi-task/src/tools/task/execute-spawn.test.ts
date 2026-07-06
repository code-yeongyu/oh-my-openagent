import { describe, expect, test } from "bun:test"

import type { ManagerStartSpec, StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

describe("buildTaskExecute spawn", () => {
  test("#given run_in_background true #when executed #then it returns immediately WITHOUT awaiting child completion", async () => {
    // given a manager whose waitFor never resolves; a background call must not touch it
    let waitForCalls = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "started",
        task_id: "st_00000001",
        status: "running",
        name: "bg-task",
      }),
      waitFor: () => {
        waitForCalls += 1
        return new Promise<TaskRecord>(() => {})
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute(
      "call-1",
      { prompt: "explore", category: "quick", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(waitForCalls).toBe(0)
    expect(result.details.task_id).toBe("st_00000001")
    expect(result.details.status).toBe("running")
    expect(result.details.run_in_background).toBe(true)
    expect(result.content[0]?.type).toBe("text")
  })

  test("#given the caller session #when spawning #then callerSessionId is injected as parent_session_id", async () => {
    // given
    let captured: ManagerStartSpec | undefined
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        captured = spec
        return { kind: "started", task_id: "st_00000002", status: "running", name: "t" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    await execute("c", { prompt: "p", category: "quick", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(captured?.parent_session_id).toBe("parent-session-1")
    expect(captured?.root_session_id).toBe("parent-session-1")
    expect(captured?.depth).toBe(1)
    expect(captured?.category).toBe("quick")
  })

  test("#given load_skills #when spawning #then resolved SKILL.md content is prepended to the child prompt", async () => {
    // given
    let captured: ManagerStartSpec | undefined
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        captured = spec
        return { kind: "started", task_id: "st_00000003", status: "running", name: "t" }
      },
    })
    const deps = makeDeps(manager, {
      loadSkills: (names) => ({
        prepend: names.length > 0 ? "SKILL DIRECTIVE\n\n" : "",
        resolved: names,
        missing: [],
      }),
    })
    const execute = buildTaskExecute(deps)

    // when
    await execute(
      "c",
      { prompt: "do the thing", category: "quick", load_skills: ["reviewer"], run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(captured?.prompt.startsWith("SKILL DIRECTIVE")).toBe(true)
    expect(captured?.prompt.endsWith("do the thing")).toBe(true)
  })

  test("#given run_in_background falsy #when executed #then it composes start + waitFor and returns the final response inline", async () => {
    // given
    let waitForId: string | undefined
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "started",
        task_id: "st_00000004",
        status: "running",
        name: "sync-task",
      }),
      waitFor: async (taskId): Promise<TaskRecord> => {
        waitForId = taskId
        return makeRecord({ task_id: "st_00000004", status: "completed", final_response: "THE FINAL ANSWER" })
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("c", { prompt: "p", subagent_type: "oracle" }, undefined, undefined, CTX)

    // then
    expect(waitForId).toBe("st_00000004")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("THE FINAL ANSWER")
    expect(text).toContain("st_00000004")
    expect(result.details.status).toBe("completed")
  })

  test("#given both category and subagent_type #when executed #then it returns the XOR error result without spawning", async () => {
    // given
    let started = false
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        started = true
        return { kind: "started", task_id: "st_x", status: "running", name: "t" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute(
      "c",
      { prompt: "p", category: "quick", subagent_type: "oracle" },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(started).toBe(false)
    expect(result.details.status).toBe("invalid_arguments")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("EITHER category OR subagent_type")
  })

  test("#given an unknown category #when executed #then it returns the category-listing plan error", async () => {
    // given
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "plan_unresolved",
        error: {
          code: "unknown_target",
          message: 'Category "nope" not found',
          availableCategories: ["quick", "deep"],
        },
      }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("c", { prompt: "p", category: "nope" }, undefined, undefined, CTX)

    // then
    expect(result.details.status).toBe("plan_error")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("quick")
    expect(text).toContain("deep")
  })

  test("#given an injected ancestry #when spawning #then child depth and root derive from it", async () => {
    // given
    let captured: ManagerStartSpec | undefined
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        captured = spec
        return { kind: "started", task_id: "st_0000000f", status: "running", name: "t" }
      },
    })
    const deps = makeDeps(manager, { resolveAncestry: () => ({ depth: 2, rootSessionId: "root-session" }) })
    const execute = buildTaskExecute(deps)

    // when
    await execute("c", { prompt: "p", category: "quick", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(captured?.depth).toBe(3)
    expect(captured?.root_session_id).toBe("root-session")
  })
})
