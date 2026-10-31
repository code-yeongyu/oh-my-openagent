import { afterEach, describe, expect, test } from "bun:test"

import { createTaskRecordStore } from "../store"
import type { ResolvedModelRecord, TaskRecord } from "../state"
import { createTaskManager } from "./manager"
import type { ManagerStartSpec, ResolvedChildPlan } from "./types"
import { baseSpec, cleanupProjects, settings, tempProject } from "./__fixtures__/manager-fakes"
import { CLAUDE, createParentModelWorld, type ParentModelWorld, type Step } from "./__fixtures__/parent-model-world"

const PRIMARY = `${CLAUDE}/primary`
const SIBLING = `${CLAUDE}/sibling`
const RESET = "2099-10-29T04:27:07Z"

const rung = (display: string): ResolvedModelRecord => {
  const [provider = "", id = ""] = display.split("/")
  return { source: "category", provider, model_id: id, display }
}

const chain = (...fallbacks: readonly string[]): ResolvedChildPlan => ({
  model: PRIMARY,
  category: "unspecified-high",
  requested_model: rung(PRIMARY),
  resolved_model: rung(PRIMARY),
  fallback_models: fallbacks.map(rung),
})

type TaskManager = ReturnType<typeof createTaskManager>

let world: ParentModelWorld | undefined
afterEach(async () => {
  await world?.dispose()
  world = undefined
  cleanupProjects()
})

async function managerFor(scripts: Readonly<Record<string, readonly Step[]>>, plan: ResolvedChildPlan): Promise<TaskManager> {
  world = await createParentModelWorld(scripts)
  const project = tempProject()
  const runner = world.runner()
  return createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan }),
    config: settings({ default_concurrency: 2, max_depth: 1 }),
    cwd: project,
    destruction: { destroyResidentTask: async () => {} },
    limitProbeTimeoutMs: 200,
  })
}

async function runChild(manager: TaskManager, spec?: Partial<ManagerStartSpec>): Promise<TaskRecord> {
  const started = await manager.start(baseSpec({ category: "unspecified-high", parent_model: SIBLING, ...spec }))
  if (started.kind === "started") return manager.waitFor(started.task_id)
  if (started.kind === "start_failed" && started.task_id !== "") return manager.waitFor(started.task_id)
  throw new Error(`child did not start: ${JSON.stringify(started)}`)
}

const calls = (): readonly string[] => world?.calls.map((call) => call.model) ?? []

// The engine walks the same chain first and, reading this wording as account-wide, exhausts it without trying the
// sibling (the senpi half of #11383); every rung here shares the spent provider, as in the incident, so omo's own walk
// is what runs the one probe.
describe("an ambiguous usage limit's same-provider probe (#11383)", () => {
  test("#given one child's probe confirmed its provider's account limit #when a second child hits a limit on that provider #then it is refused without calling the provider again", async () => {
    // given
    const manager = await managerFor({ [PRIMARY]: ["weekly", "weekly"], [SIBLING]: ["weekly", "weekly"] }, chain(SIBLING))
    try {
      const first = await runChild(manager)
      expect(first.status).toBe("error")
      expect(calls()).toEqual([PRIMARY, SIBLING])

      // when
      const second = await runChild(manager)

      // then
      expect(second.status).toBe("error")
      expect(second.error_message).toContain(RESET)
      expect(calls()).toEqual([PRIMARY, SIBLING])
    } finally {
      manager.workpools.dispose()
    }
  }, 10_000)

  test("#given the probe rung never answers #when the probe timeout passes #then the child fails with the provider's limit and a later child is refused without a call", async () => {
    // given
    const manager = await managerFor({ [PRIMARY]: ["weekly", "weekly"], [SIBLING]: ["silent"] }, chain(SIBLING))
    try {
      // when
      const first = await runChild(manager)

      // then
      expect(first.status).toBe("error")
      expect(first.error_message).toContain(RESET)
      expect(calls()).toEqual([PRIMARY, SIBLING])

      const second = await runChild(manager)
      expect(second.status).toBe("error")
      expect(second.error_message).toContain(RESET)
      expect(calls()).toEqual([PRIMARY, SIBLING])
    } finally {
      manager.workpools.dispose()
    }
  }, 10_000)
})
