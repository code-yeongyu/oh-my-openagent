import { afterEach, describe, expect, test } from "bun:test"

import { createManagerResidencyRegistry } from "../../../omo-senpi/src/components/task/residency-registry"
import { createTaskLifecycle } from "../lifecycle/create"
import { hostRunnerHarness } from "../runners/rpc-host.test-support"
import type { ResolvedModelRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { adaptRpcHandle, type ManagedChildHandle } from "./child-handle"
import { baseSpec, cleanupProjects, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type { ManagedRunner } from "./types"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"

// The failed rung's live handle closes its daemon session best-effort and gives up after a bounded
// wait. Runtime fallback must not take that as proof the session is gone: the next model starts only
// once the daemon confirmed the close.

const harness = hostRunnerHarness()

afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

function rung(id: string): ResolvedModelRecord {
  return { source: "category", provider: "test", model_id: id, display: `test/${id}` }
}

describe("runtime fallback over a live daemon session", () => {
  for (const acknowledged of [true, false] as const) {
    test(`#given the failed rung's close_session is ${acknowledged ? "acknowledged" : "never acknowledged"} #when fallback runs #then ${acknowledged ? "the next rung replaces it" : "the task fails and the next rung never starts beside it"}`, async () => {
      // given
      const project = tempProject()
      const store = createTaskRecordStore({ project_dir: project })
      const host = await harness.fakeHost()
      const rpc = harness.runnerOver(host, { closeGraceMs: 50 })
      const launched: ManagedChildHandle[] = []
      const runner: ManagedRunner = {
        start: async (spec) => {
          const handle = adaptRpcHandle(await rpc.start({ task_id: spec.taskId, cwd: project, state_dir: spec.stateDir, prompt: spec.prompt, model: spec.model }))
          launched.push(handle)
          return handle
        },
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
        hostEndpoint: NO_HOST_ENDPOINT,
        store,
        config,
        registry: createManagerResidencyRegistry(() => manager),
        idleReclaimerScheduler: { setInterval: () => ({}), clearInterval: () => undefined },
        hostCloseTimeoutMs: 50,
      })
      const task = await manager.start(baseSpec())
      if (task.kind !== "started") throw new Error("expected the task to start")
      const [original] = host.sessions()
      if (original === undefined) throw new Error("expected the failed rung's session")
      if (!acknowledged) host.withholdReply("close_session")
      const settled = acknowledged ? undefined : manager.waitFor(task.task_id, { signal: AbortSignal.timeout(10_000) })

      try {
        // when
        host.emitRecord(original.routingId, { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "provider failed" } })
        host.emitRecord(original.routingId, { type: "agent_end", willRetry: false, messages: [] })
        host.emitRecord(original.routingId, { type: "agent_idle" })

        // then
        if (acknowledged) {
          const nextOpened = host.waitForCommand("prompt")
          await nextOpened
          expect(host.sessions().map((session) => session.sessionPath)).not.toContain(original.sessionPath)
        } else {
          if (settled === undefined) throw new Error("expected a terminal wait for the unconfirmed close")
          const record = await settled
          expect(record.status).toBe("error")
          expect(launched).toHaveLength(1)
          expect(record.fallback_closing_child?.host_session?.session_path ?? record.host_session?.session_path).toBe(original.sessionPath)
        }
      } finally {
        for (const handle of launched) await handle.dispose()
        for (const id of manager.residentTaskIds()) manager.forget(id, { path: "end" })
        lifecycle.dispose?.()
        manager.workpools.dispose()
      }
    })
  }
})
