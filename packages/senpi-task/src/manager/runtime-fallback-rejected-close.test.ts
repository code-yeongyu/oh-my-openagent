import { afterEach, describe, expect, test } from "bun:test"

import { createManagerResidencyRegistry } from "../../../omo-senpi/src/components/task/residency-registry"
import { createTaskLifecycle } from "../lifecycle/create"
import { hostRunnerHarness } from "../runners/rpc-host.test-support"
import type { ResolvedModelRecord, TaskRecord } from "../state"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import { adaptRpcHandle } from "./child-handle"
import { baseSpec, cleanupProjects, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type { ManagedRunner } from "./types"

// Invariant: every committed state of a record whose failed rung was never confirmed closed still names
// that rung's session, so a parent that dies after any single write leaves recovery something to close.

const harness = hostRunnerHarness()

afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

function rung(id: string): ResolvedModelRecord {
  return { source: "category", provider: "test", model_id: id, display: `test/${id}` }
}

function namedSession(record: TaskRecord | null): string | undefined {
  return record?.fallback_closing_child?.host_session?.session_path ?? record?.host_session?.session_path
}

function recordingStore(backing: TaskRecordStore, committed: Array<TaskRecord | null>): TaskRecordStore {
  return {
    ...backing,
    mutate: (taskId, update) => {
      const after = backing.mutate(taskId, update)
      committed.push(after)
      return after
    },
  }
}

describe("runtime fallback whose failed-rung close is never acknowledged", () => {
  test("#given the daemon never acknowledges close_session #when the handoff fails #then no committed write loses the old session and it stays on the record", async () => {
    // given
    const project = tempProject()
    const committed: Array<TaskRecord | null> = []
    const store = recordingStore(createTaskRecordStore({ project_dir: project }), committed)
    const host = await harness.fakeHost()
    const rpc = harness.runnerOver(host, { closeGraceMs: 50 })
    const runner: ManagedRunner = {
      start: async (spec) => adaptRpcHandle(await rpc.start({ task_id: spec.taskId, cwd: project, state_dir: spec.stateDir, prompt: spec.prompt, model: spec.model })),
    }
    const config = settings()
    const manager = createTaskManager({
      store,
      config,
      cwd: project,
      runners: { process: runner, "in-process": runner },
      planner: () => ({ kind: "resolved", plan: { model: "test/old", requested_model: rung("old"), resolved_model: rung("old"), fallback_models: [rung("next")] } }),
      destruction: { destroyResidentTask: (taskId, cause) => lifecycle.destroyResidentTask(taskId, cause) },
    })
    const lifecycle = createTaskLifecycle({
      store,
      config,
      registry: createManagerResidencyRegistry(() => manager),
      idleReclaimerScheduler: { setInterval: () => ({}), clearInterval: () => undefined },
      hostCloseTimeoutMs: 50,
    })
    const task = await manager.start(baseSpec({ execution_mode: "process" }))
    if (task.kind !== "started") throw new Error("expected the task to start")
    const [original] = host.sessions()
    if (original === undefined) throw new Error("expected the failed rung's session")
    host.withholdReply("close_session")
    const settled = manager.waitFor(task.task_id, { signal: AbortSignal.timeout(10_000) })

    try {
      // when
      host.emitRecord(original.routingId, { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "provider failed" } })
      host.emitRecord(original.routingId, { type: "agent_end", willRetry: false, messages: [] })
      const record = await settled

      // then
      const handoffStart = committed.findIndex((entry) => entry?.fallback_closing_child !== undefined)
      expect(record.status).toBe("error")
      expect(handoffStart).toBeGreaterThanOrEqual(0)
      const losingWrites = committed.slice(handoffStart).filter((entry) => namedSession(entry) !== original.sessionPath)
      expect(losingWrites).toHaveLength(0)
      expect(host.sessions().map((session) => session.sessionPath)).toContain(original.sessionPath)
    } finally {
      await manager.getResidentHandle(task.task_id)?.dispose()
      for (const id of manager.residentTaskIds()) manager.forget(id)
      lifecycle.dispose?.()
      manager.workpools.dispose()
    }
  })
})
