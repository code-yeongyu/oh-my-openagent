import { describe, expect, test } from "bun:test"

import type { ManagerStartSpec, StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

describe("buildTaskExecute spawn", () => {
  test("#given run_in_background true #when executed #then it returns immediately WITHOUT awaiting child completion", async () => {
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

    const result = await execute(
      "call-1",
      { prompt: "explore", category: "quick", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    expect(waitForCalls).toBe(0)
    expect(result.details.task_id).toBe("st_00000001")
    expect(result.details.status).toBe("running")
    expect(result.details.run_in_background).toBe(true)
    expect(result.content[0]?.type).toBe("text")
  })

  test("#given a background task #when the start result is rendered #then it directs the parent to yield instead of polling", async () => {
    // given
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "started",
        task_id: "st_00000015",
        status: "running",
        name: "background-research",
      }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute(
      "call-background-guidance",
      { prompt: "research", category: "deep", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    const normalized = text.toLowerCase()
    expect(normalized).toContain("automatically delivered")
    expect(normalized).toContain("end your turn")
    expect(normalized).toContain("independent work")
    expect(normalized).not.toContain("read progress")
  })

  test("#given the caller session #when spawning #then callerSessionId is injected as parent_session_id", async () => {
    let captured: ManagerStartSpec | undefined
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        captured = spec
        return { kind: "started", task_id: "st_00000002", status: "running", name: "t" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    await execute("c", { prompt: "p", category: "quick", run_in_background: true }, undefined, undefined, CTX)

    expect(captured?.parent_session_id).toBe("parent-session-1")
    expect(captured?.root_session_id).toBe("parent-session-1")
    expect(captured?.depth).toBe(1)
    expect(captured?.category).toBe("quick")
  })

  test("#given a resolved background start #when executed #then resolved metadata and background mode reach result details without prompt persistence", async () => {
    // given
    const resolvedModel = {
      provider: "openai",
      model_id: "gpt-5.6-sol",
      display: "GPT-5.6 Sol",
      reasoning_effort: "xhigh",
      source: "category" as const,
    }
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "started",
        task_id: "st_00000013",
        status: "running",
        name: "resolved-bg",
        resolved_model: resolvedModel,
      }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute(
      "call-resolved-bg",
      { prompt: "sensitive prompt", category: "ultrabrain", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(result.details.resolved_model).toEqual(resolvedModel)
    expect(result.details.run_in_background).toBe(true)
    expect(Object.hasOwn(result.details, "prompt")).toBe(false)
  })

  test("#given config default execution mode #when spawning without an agent overlay #then config mode reaches the start spec", async () => {
    let captured: ManagerStartSpec | undefined
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        captured = spec
        return { kind: "started", task_id: "st_00000012", status: "running", name: "t" }
      },
    })
    const execute = buildTaskExecute(
      makeDeps(manager, {
        omoConfig: {
          categories: {},
          agents: {},
          task: {
            default_execution_mode: "process",
            default_concurrency: 5,
            global_concurrency: 8,
            max_depth: 1,
            residency_max_children: 8,
            ttl_ms: 86400000,
            resume_children: true,
            wait: { min_ms: 5000, default_ms: 60000, max_ms: 600000 },
            warnings: { unavailable_categories: true },
            team: { max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 },
          },
        },
      }),
    )

    await execute("c", { prompt: "p", category: "quick", run_in_background: true }, undefined, undefined, CTX)

    expect(captured?.execution_mode).toBe("process")
  })

  test("#given run_in_background falsy #when executed #then it composes start + waitFor and returns the final response inline", async () => {
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
    const execute = buildTaskExecute(
      makeDeps(manager, {
        resolveSkillInvocations: () => ({
          hasInvoked: (skill: string) => skill === "ulw-plan",
          hasUserRequested: (skill: string) => skill === "ulw-plan",
          hasPlanArtifact: () => true,
          planArtifactReferences: () => [{ path: ".omo/plans/spawn-plan.md", count: 1, lastTouchedAt: 1 }],
        }),
      }),
    )

    const result = await execute("c", { prompt: "p", subagent_type: "momus" }, undefined, undefined, CTX)

    expect(waitForId).toBe("st_00000004")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("THE FINAL ANSWER")
    expect(text).toContain("st_00000004")
    expect(result.details.status).toBe("completed")
  })

  test("#given a resolved foreground record #when execution completes #then resolved metadata, raw model fallback, and foreground mode reach details", async () => {
    // given
    const resolvedModel = {
      provider: "openai",
      model_id: "gpt-5.6-sol",
      display: "GPT-5.6 Sol",
      variant: "reasoning",
      reasoning_effort: "xhigh",
      source: "category" as const,
    }
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "started",
        task_id: "st_00000014",
        status: "running",
        name: "resolved-fg",
        resolved_model: resolvedModel,
      }),
      waitFor: async (): Promise<TaskRecord> =>
        makeRecord({
          task_id: "st_00000014",
          status: "completed",
          category: "ultrabrain",
          model: "openai/gpt-5.6-sol",
          resolved_model: resolvedModel,
          final_response: "done",
        }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("call-resolved-fg", { prompt: "finish", category: "ultrabrain" }, undefined, undefined, CTX)

    // then
    expect(result.details.resolved_model).toEqual(resolvedModel)
    expect(result.details.model).toBe("openai/gpt-5.6-sol")
    expect(result.details.run_in_background).toBe(false)
  })

})
