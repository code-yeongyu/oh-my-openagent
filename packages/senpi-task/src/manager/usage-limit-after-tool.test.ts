import { afterEach, expect, test } from "bun:test"

import type { ResolvedModelRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { baseSpec, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import { createUsageLimitMemory } from "./usage-limit-memory"

afterEach(cleanupProjects)

const primary: ResolvedModelRecord = { source: "category", provider: "test", model_id: "first", display: "test/first" }
const ACCOUNT_LIMIT = "Account usage limit reached"

test("#given a task that ran a tool #when its turn ends on a terminal account usage limit #then the task fails without replaying and a later independent task is refused without a call (review 15140 #3)", async () => {
  // given
  const project = tempProject()
  const memory = createUsageLimitMemory(Date.now)
  const runner = new FakeRunner()
  const manager = createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    usageLimits: memory,
    cwd: project,
    runners: { process: runner, "in-process": runner },
    planner: () => ({
      kind: "resolved",
      plan: { model: primary.display, resolved_model: primary, fallback_models: [] },
    }),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
  })
  try {
    const first = await manager.start(baseSpec())
    if (first.kind !== "started") throw new Error("expected start")
    const fake = runner.handles.get(first.task_id)
    if (fake === undefined) throw new Error("expected the child")
    await fake.waitForSubscription()
    fake.emit({ type: "tool_execution_start", toolName: "write", args: {} })

    // when
    const ended = manager.waitFor(first.task_id)
    fake.settle({ status: "error", failure: { kind: "child-turn-failed", message: ACCOUNT_LIMIT } })
    expect((await ended).status).toBe("error")

    // then
    expect(runner.startedSpecs).toHaveLength(1)
    const second = await manager.start(baseSpec())
    expect(second).toMatchObject({ kind: "start_failed", failure_kind: "usage_limit" })
    expect(runner.startedSpecs).toHaveLength(1)
  } finally {
    manager.workpools.dispose()
  }
})
