import { afterEach, describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { CLAUDE, createParentModelWorld, GPT, type ParentModelWorld } from "../../../../senpi-task/src/manager/__fixtures__/parent-model-world"
import { baseSpec, cleanupProjects, settings, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../../../../senpi-task/src/manager/manager"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { createTaskChildPlanner, type TaskModelRegistry } from "./planner"

const ASTRA = `${GPT}/gpt-6-astra`
const CLAUDE_PARENT = `${CLAUDE}/claude-opus-5-5`

const plannerModels: readonly SenpiModelPort[] = [{ provider: GPT, id: "gpt-6-astra" }, { provider: CLAUDE, id: "claude-opus-5-5" }]
const plannerRegistry: TaskModelRegistry = {
  getAvailable: () => plannerModels,
  find: (provider, id) => plannerModels.find((model) => model.provider === provider && model.id === id),
}

let world: ParentModelWorld | undefined
afterEach(() => {
  world?.dispose()
  world = undefined
  cleanupProjects()
})

// The plan comes from the real planner, so the shipped deep-high default is merged with the omo.json override
// exactly as a live spawn merges it, then the child runs on a real senpi engine whose only rung is at quota.
async function runDeepHigh(config: OmoConfig): Promise<{ readonly record: TaskRecord; readonly world: ParentModelWorld }> {
  world = await createParentModelWorld({ [ASTRA]: ["quota"] })
  const project = tempProject()
  const runner = world.runner()
  const manager = createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": runner, process: runner },
    planner: createTaskChildPlanner(config, {}, () => plannerRegistry),
    config: settings({ default_concurrency: 2, max_depth: 1 }),
    cwd: project,
    destruction: { destroyResidentTask: async () => {} },
  })
  try {
    const started = await manager.start(baseSpec({ category: "deep-high", parent_model: CLAUDE_PARENT }))
    if (started.kind !== "started") throw new Error(`child did not start: ${JSON.stringify(started)}`)
    return { record: await manager.waitFor(started.task_id), world }
  } finally {
    manager.workpools.dispose()
  }
}

describe("deep-high provider_lock through the merged omo.json config (#12006)", () => {
  test("#given an omo.json override that changes only the deep-high model #when its OpenAI-only chain hits quota under a Claude parent #then the shipped lock survives the merge and the child fails typed without calling the parent", async () => {
    // given / when
    const { record, world } = await runDeepHigh({ categories: { "deep-high": { model: ASTRA } } })

    // then
    expect(world.calls.map((call) => call.model)).toEqual([ASTRA])
    expect(record.status).toBe("error")
    expect(record.parent_model).toBeUndefined()
    expect(record.provider_lock).toBe("openai")
    expect(record.failure_kind).toBe("provider_lock_exhausted")
  }, 30_000)

  test("#given the same override plus provider_lock false #when the chain hits quota under a Claude parent #then the parent rung is kept and the child completes on the parent's model", async () => {
    // given / when
    const { record, world } = await runDeepHigh({ categories: { "deep-high": { model: ASTRA, provider_lock: false } } })

    // then
    expect(world.calls.map((call) => call.model)).toEqual([ASTRA, CLAUDE_PARENT])
    expect(record.status).toBe("completed")
    expect(record.parent_model).toBe(CLAUDE_PARENT)
    expect(record.provider_lock).toBeUndefined()
    expect(record.failure_kind).toBeUndefined()
  }, 30_000)
})
