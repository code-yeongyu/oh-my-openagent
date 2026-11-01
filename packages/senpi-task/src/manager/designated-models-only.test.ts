import { afterEach, describe, expect, test } from "bun:test"

import { buildTaskExecute } from "../tools/task/execute"
import { makeDeps } from "../tools/task/__fixtures__/task-tool-fakes"
import { createTaskRecordStore } from "../store"
import type { ResolvedModelRecord, TaskRecord } from "../state"
import { createTaskManager } from "./manager"
import type { ResolvedChildPlan } from "./types"
import { cleanupProjects, settings, tempProject } from "./__fixtures__/manager-fakes"
import { ALT, CLAUDE, COUNT_TOOL, createModelChainWorld, GPT, type ModelChainWorld, type Step } from "./__fixtures__/model-chain-world"

// The parent session runs on a working, logged-in model of another provider. No child may ever call it.
const PARENT_MODEL = { provider: GPT, id: "parent" } as const
const PARENT = `${GPT}/parent`
const PRIMARY = `${CLAUDE}/primary`
const SECOND = `${ALT}/rung`

const rung = (display: string): ResolvedModelRecord => {
  const [provider = "", id = ""] = display.split("/")
  return { source: "category", provider, model_id: id, display }
}

function chainPlan(category: string, chain: readonly string[]): ResolvedChildPlan {
  const [head, ...rest] = chain.map(rung)
  if (head === undefined) throw new Error("empty chain")
  return { model: head.display, category, requested_model: head, resolved_model: head, fallback_models: rest }
}

let world: ModelChainWorld | undefined
afterEach(() => {
  world?.dispose()
  world = undefined
  cleanupProjects()
})

async function runCategoryChild(input: {
  readonly category: string
  readonly chain: readonly string[]
  readonly scripts: Readonly<Record<string, readonly Step[]>>
}): Promise<{ readonly record: TaskRecord; readonly world: ModelChainWorld }> {
  world = await createModelChainWorld(input.scripts)
  const project = tempProject()
  const runner = world.runner()
  const manager = createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan: chainPlan(input.category, input.chain) }),
    config: settings({ default_concurrency: 2, max_depth: 1 }),
    cwd: project,
    destruction: { destroyResidentTask: async () => {} },
  })
  try {
    // The parent session calls the real task tool while it runs on PARENT_MODEL.
    const execute = buildTaskExecute(makeDeps(manager))
    const result = await execute("call-1", { prompt: "do the thing", category: input.category, run_in_background: true }, undefined, undefined, {
      cwd: project,
      sessionManager: { getSessionId: () => "parent-1" },
      model: PARENT_MODEL,
    })
    const taskId = result.details.task_id
    if (typeof taskId !== "string" || !taskId.startsWith("st_")) throw new Error(`child did not start: ${JSON.stringify(result.details)}`)
    return { record: await manager.waitFor(taskId), world }
  } finally {
    manager.workpools.dispose()
  }
}

describe("a child runs only on its designated models, never on the parent's model", () => {
  test.each([
    ["unspecified-high", "quota", "usage limit (resets 3:20am)"],
    ["unspecified-high", "refusal", "refused"],
    ["unspecified-high", "auth", "not signed in"],
    ["deep-high", "quota", "usage limit (resets 3:20am)"],
    ["deep-low", "refusal", "refused"],
    ["quick", "auth", "not signed in"],
  ] as const)("#given a %s child whose only model fails with %s #when the chain is exhausted #then the parent model is never called and the task fails typed naming the model and why", async (category, step, why) => {
    // given / when
    const { record, world } = await runCategoryChild({ category, chain: [PRIMARY], scripts: { [PRIMARY]: [step] } })

    // then
    expect(world.calls.map((call) => call.model)).toEqual([PRIMARY])
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("model_chain_exhausted")
    expect(record.error_message).toContain(`${PRIMARY}: ${why}`)
    expect("parent_model" in record).toBe(false)
  }, 30_000)

  test.each(["quota", "refusal", "auth"] as const)("#given a two-model chain where both fail with %s #when the chain is exhausted #then both designated models ran, the parent never did, and the failure lists each", async (step) => {
    // given / when
    const { record, world } = await runCategoryChild({
      category: "deep-high",
      chain: [PRIMARY, SECOND],
      scripts: { [PRIMARY]: [step], [SECOND]: [step] },
    })

    // then
    expect(world.calls.map((call) => call.model)).not.toContain(PARENT)
    expect(new Set(world.calls.map((call) => call.model))).toEqual(new Set([PRIMARY, SECOND]))
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("model_chain_exhausted")
    expect(record.error_message).toContain(`${PRIMARY}: `)
    expect(record.error_message).toContain(`${SECOND}: `)
  }, 30_000)

  test("#given the only designated model ran a tool and then hit its usage limit #when the turn fails #then the tool ran once, the parent was never called, and the task fails typed", async () => {
    // given / when
    const { record, world } = await runCategoryChild({ category: "deep-high", chain: [PRIMARY], scripts: { [PRIMARY]: [{ tool: COUNT_TOOL }, "quota"] } })

    // then
    expect(world.calls.map((call) => call.model)).toEqual([PRIMARY, PRIMARY])
    expect(world.toolRuns()).toBe(1)
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("model_chain_exhausted")
    expect(record.error_message).toContain(`${PRIMARY}: usage limit (resets 3:20am)`)
  }, 30_000)

  test("#given a designated second model that works #when the first hits its usage limit #then the child completes on the second, never on the parent", async () => {
    // given / when
    const { record, world } = await runCategoryChild({ category: "unspecified-low", chain: [PRIMARY, SECOND], scripts: { [PRIMARY]: ["quota"] } })

    // then
    expect(record.status).toBe("completed")
    expect(world.calls.map((call) => call.model)).toEqual([PRIMARY, SECOND])
  }, 30_000)
})
