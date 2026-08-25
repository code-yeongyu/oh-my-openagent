import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { TaskManager } from "../../manager"
import { createTaskTool } from "./tool"
import type { TaskToolDeps } from "./types"
import { resolveSpawnItems } from "./validation"

const OMO_CONFIG: OmoConfig = { categories: {}, agents: {} }

function notImplemented(name: string): never {
  throw new Error(`fake TaskManager.${name} not configured`)
}

function fakeManager(): TaskManager {
  return {
    start: () => notImplemented("start"),
    startOwned: () => notImplemented("startOwned"),
    findOwnedTask: () => undefined,
    continueTask: () => notImplemented("continueTask"),
    sendToTask: () => notImplemented("sendToTask"),
    interruptTask: () => notImplemented("interruptTask"),
    cancelTask: () => notImplemented("cancelTask"),
    get: () => undefined,
    list: () => [],
    waitFor: () => notImplemented("waitFor"),
    forget: () => {},
    getResidentHandle: () => undefined,
    subscribeChild: () => () => {},
    residentTaskIds: () => [],
    promoteToBackground: () => true,
    wasBackground: () => false,
    runStatsSnapshot: () => undefined,
  }
}

function createTool() {
  const deps: TaskToolDeps = {
    manager: fakeManager(),
    omoConfig: OMO_CONFIG,
    agents: { explore: { name: "explore", description: "Read-only code search" } },
  }
  return createTaskTool(deps)
}

describe("task argument normalization", () => {
  test("#given a GPT-padded single spawn #when arguments are prepared #then serializer-only fields are removed", () => {
    // given
    const tool = createTool()
    const prepareArguments = tool.prepareArguments

    // then
    expect(typeof prepareArguments).toBe("function")
    if (prepareArguments === undefined) throw new Error("task prepareArguments is missing")

    // when
    const prepared = prepareArguments({
      prompt: "TASK: Audit the task tool boundary.",
      description: "Audit task tool",
      category: "",
      subagent_type: "explore",
      run_in_background: true,
      name: "task-padding-audit",
      model: "",
      load_skills: [],
      tasks: [
        {
          prompt: "unused",
          description: "unused",
          category: "quick",
          subagent_type: "",
          name: "unused",
          model: "",
          load_skills: [],
        },
      ],
    })

    // then
    expect(prepared).toEqual({
      prompt: "TASK: Audit the task tool boundary.",
      description: "Audit task tool",
      subagent_type: "explore",
      run_in_background: true,
      name: "task-padding-audit",
    })
  })

  test("#given a GPT-padded batch #when arguments are prepared #then blank top-level prompt and item overrides do not block fan-out", () => {
    // given
    const tool = createTool()
    const prepareArguments = tool.prepareArguments
    if (prepareArguments === undefined) throw new Error("task prepareArguments is missing")

    // when
    const prepared = prepareArguments({
      prompt: "",
      description: "",
      category: "",
      subagent_type: "",
      run_in_background: true,
      name: "",
      model: "",
      load_skills: ["audit"],
      tasks: [
        {
          prompt: "TASK: Inspect the argument schema.",
          description: "",
          category: "",
          subagent_type: "explore",
          name: "",
          model: "",
          load_skills: [],
        },
        {
          prompt: "TASK: Inspect the prompt surfaces.",
          description: "",
          category: "quick",
          subagent_type: "",
          name: "",
          model: "",
          load_skills: [],
        },
      ],
    })
    const resolved = resolveSpawnItems(prepared)

    // then
    expect(resolved.kind).toBe("ok")
    if (resolved.kind !== "ok") throw new Error(resolved.error.message)
    expect(resolved.items).toHaveLength(2)
    expect(resolved.items[0]).toMatchObject({
      prompt: "TASK: Inspect the argument schema.",
      kind: "subagent_type",
      subagentType: "explore",
      load_skills: ["audit"],
    })
    expect(resolved.items[1]).toMatchObject({
      prompt: "TASK: Inspect the prompt surfaces.",
      kind: "category",
      category: "quick",
      load_skills: ["audit"],
    })
  })

  test("#given an over-limit task_summary #when arguments are prepared #then the harness force-truncates it to the schema limit", () => {
    // given
    const tool = createTool()
    const prepareArguments = tool.prepareArguments
    if (prepareArguments === undefined) throw new Error("task prepareArguments is missing")

    // when
    const prepared = prepareArguments({
      prompt: "TASK: Audit the task tool boundary.",
      task_summary: `Audit ${"z".repeat(200)}`,
      subagent_type: "explore",
    })

    // then
    expect(prepared.task_summary).toHaveLength(80)
    expect(prepared.task_summary?.endsWith("...")).toBe(true)
  })

  test("#given blank and item task_summary values #when arguments are prepared #then blanks drop and item summaries are clamped", () => {
    // given
    const tool = createTool()
    const prepareArguments = tool.prepareArguments
    if (prepareArguments === undefined) throw new Error("task prepareArguments is missing")

    // when
    const prepared = prepareArguments({
      task_summary: "   ",
      category: "quick",
      tasks: [
        { prompt: "TASK: Inspect the schema.", task_summary: "  Inspect the\n   schema surface  " },
        { prompt: "TASK: Inspect the prompts.", task_summary: "w".repeat(120) },
      ],
    })

    // then
    expect(prepared.task_summary).toBeUndefined()
    expect(prepared.tasks?.[0]?.task_summary).toBe("Inspect the schema surface")
    expect(prepared.tasks?.[1]?.task_summary).toHaveLength(80)
    expect(prepared.tasks?.[1]?.task_summary?.endsWith("...")).toBe(true)
  })

  test("#given genuinely meaningful prompt and tasks #when arguments are prepared #then semantic ambiguity remains a hard error", () => {
    // given
    const tool = createTool()
    const prepareArguments = tool.prepareArguments
    if (prepareArguments === undefined) throw new Error("task prepareArguments is missing")

    // when
    const prepared = prepareArguments({
      prompt: "TASK: Run the single assignment.",
      subagent_type: "explore",
      tasks: [{ prompt: "TASK: Run the separate batch assignment.", category: "quick" }],
    })
    const resolved = resolveSpawnItems(prepared)

    // then
    expect(resolved.kind).toBe("error")
    if (resolved.kind !== "error") throw new Error("expected meaningful prompt/tasks ambiguity to fail")
    expect(resolved.error.code).toBe("prompt_and_tasks")
  })
})
