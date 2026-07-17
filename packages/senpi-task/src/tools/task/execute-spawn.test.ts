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
            max_depth: 1,
            residency_max_children: 8,
            ttl_ms: 86400000,
            wait: { min_ms: 5000, default_ms: 60000, max_ms: 600000 },
            team: { max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 },
          },
        },
      }),
    )

    await execute("c", { prompt: "p", category: "quick", run_in_background: true }, undefined, undefined, CTX)

    expect(captured?.execution_mode).toBe("process")
  })

  test("#given load_skills #when spawning #then resolved SKILL.md content is prepended to the child prompt", async () => {
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

    await execute(
      "c",
      { prompt: "do the thing", category: "quick", load_skills: ["reviewer"], run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    expect(captured?.prompt.startsWith("SKILL DIRECTIVE")).toBe(true)
    expect(captured?.prompt.endsWith("do the thing")).toBe(true)
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
    const execute = buildTaskExecute(makeDeps(manager))

    const result = await execute("c", { prompt: "p", subagent_type: "oracle" }, undefined, undefined, CTX)

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

  test("#given both category and subagent_type #when executed #then it returns the XOR error result without spawning", async () => {
    let started = false
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        started = true
        return { kind: "started", task_id: "st_x", status: "running", name: "t" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    const result = await execute(
      "c",
      { prompt: "p", category: "quick", subagent_type: "oracle" },
      undefined,
      undefined,
      CTX,
    )

    expect(started).toBe(false)
    expect(result.details.status).toBe("invalid_arguments")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("EITHER category OR subagent_type")
  })

  test("#given an unknown category #when executed #then it returns the category-listing plan error", async () => {
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

    const result = await execute("c", { prompt: "p", category: "nope" }, undefined, undefined, CTX)

    expect(result.details.status).toBe("plan_error")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("quick")
    expect(text).toContain("deep")
  })

  test("#given an injected ancestry #when spawning #then child depth and root derive from it", async () => {
    let captured: ManagerStartSpec | undefined
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        captured = spec
        return { kind: "started", task_id: "st_0000000f", status: "running", name: "t" }
      },
    })
    const deps = makeDeps(manager, { resolveAncestry: () => ({ depth: 2, rootSessionId: "root-session" }) })
    const execute = buildTaskExecute(deps)

    await execute("c", { prompt: "p", category: "quick", run_in_background: true }, undefined, undefined, CTX)

    expect(captured?.depth).toBe(3)
    expect(captured?.root_session_id).toBe("root-session")
  })
})
