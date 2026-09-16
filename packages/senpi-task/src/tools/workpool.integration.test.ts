import { expect, test } from "bun:test"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle } from "../lifecycle"
import type { ResidencyRegistry } from "../lifecycle/port"
import { createTaskManager } from "../manager/manager"
import { TaskConcurrency } from "../manager/concurrency"
import { createTaskRecordStore } from "../store"
import { fixture, fixtureHandle, poolInput } from "../workpool/__fixtures__/admission"
import { buildWorkpoolExecute } from "./workpool"

test("#given host inspect after a new manager on the same state dir #when the kernel is reset #then the persisted pool is observed", async () => {
  const f = fixture()
  const created = await buildWorkpoolExecute({ manager: f.manager, workpools: f.manager.workpools, omoConfig: {}, agents: {} })(
    { op: "create", ...poolInput },
    { cwd: f.root, sessionManager: { getSessionId: () => f.caller.sessionId } },
  )
  const poolId = (created.details as { pool_id: `wp_${string}` }).pool_id
  await buildWorkpoolExecute({ manager: f.manager, workpools: f.manager.workpools, omoConfig: {}, agents: {} })(
    { op: "push", pool_id: poolId, items: [{ key: "a", input: 1 }] },
    { cwd: f.root, sessionManager: { getSessionId: () => f.caller.sessionId } },
  )
  f.manager.workpools.dispose()
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: 1, global_concurrency: 1, residency_max_children: 4 })
  const store = createTaskRecordStore({ project_dir: f.root })
  const concurrency = new TaskConcurrency(config)
  const runner = { start: async (spec: { taskId: string }) => fixtureHandle(spec.taskId).handle }
  const registry: ResidencyRegistry = { get: () => undefined, entries: () => [], forget: () => undefined, hasPendingSends: () => false, tryClaimEviction: () => false, releaseEviction: () => undefined }
  const lifecycle = createTaskLifecycle({ store, registry, config })
  const manager = createTaskManager({ store, concurrency, runners: { "in-process": runner, process: runner }, config, cwd: f.root,
    planner: spec => ({ kind: "resolved", plan: { model: spec.model ?? "test/model" } }), destruction: lifecycle, admit: async () => ({ kind: "admitted" }) })
  const inspect = await buildWorkpoolExecute({ manager, workpools: manager.workpools, omoConfig: {}, agents: {} })(
    { op: "inspect", pool_id: poolId },
    { cwd: f.root, sessionManager: { getSessionId: () => f.caller.sessionId } },
  )
  expect(inspect.isError).toBeUndefined()
  expect(inspect.details).toMatchObject({ pool_id: poolId, items: [{ key: "a" }] })
  const denied = await buildWorkpoolExecute({ manager, workpools: manager.workpools, omoConfig: {}, agents: {} })(
    { op: "inspect", pool_id: poolId },
    { cwd: f.root, sessionManager: { getSessionId: () => "other-session" } },
  )
  expect(denied.details).toMatchObject({ error: { code: "scope_denied" } })
})
