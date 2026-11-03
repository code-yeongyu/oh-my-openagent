import { afterEach, describe, expect, jest, spyOn, test } from "bun:test"
import { bounded } from "../lifecycle/__fixtures__/live-parent-clock"

import { createManagerResidencyRegistry } from "../../../omo-senpi/src/components/task/residency-registry"
import { createTaskLifecycle } from "../lifecycle/create"
import { hostRunnerHarness } from "../runners/rpc-host.test-support"
import type { ResolvedModelRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { adaptRpcHandle, type ManagedChildHandle } from "./child-handle"
import { baseSpec, cleanupProjects, launchSettled, settings, tempProject } from "./__fixtures__/manager-fakes"
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
  for (const [acknowledged, lateReply] of [[true, false], [true, true], [false, false]] as const) {
    test(`#given the failed rung's close_session is ${acknowledged ? (lateReply ? "acknowledged after its close grace" : "acknowledged") : "never acknowledged"} #when fallback runs #then ${acknowledged ? "the next rung replaces it" : "the task fails and the next rung never starts beside it"}`, async () => {
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
      await launchSettled(manager, task.task_id)
      const [original] = host.sessions()
      if (original === undefined) throw new Error("expected the failed rung's session")
      store.mutate(task.task_id, record => ({ ...record, pending_steering: [
        { id: "queued-1", message: "Q1", deliver_as: "steer" },
        { id: "queued-2", message: "Q2", deliver_as: "steer" },
      ] }))
      let deliveries = 0
      const drained = Promise.withResolvers<void>()
      const append = store.appendEvent.bind(store)
      spyOn(store, "appendEvent").mockImplementation((id, event) => {
        const result = append(id, event)
        if (id === task.task_id && event.type === "steered") {
          deliveries += 1
          if (deliveries === 2) drained.resolve()
        }
        return result
      })
      if (!acknowledged) host.withholdReply("close_session")
      // The Windows failure (#9489): the acknowledgement lands after the 50 ms grace. It is released by a real
      // timer armed before the grace clock is frozen, so it arrives in real time either way.
      const releaseClose = lateReply ? host.holdReply("close_session") : undefined
      const lateClose = releaseClose === undefined ? undefined : setTimeout(releaseClose, 200)
      const settled = acknowledged ? undefined : manager.waitFor(task.task_id, { signal: AbortSignal.timeout(10_000) })
      const nextOpened = acknowledged ? host.waitForCommand("prompt") : undefined
      let timeout: ReturnType<typeof setTimeout> | undefined
      // Arm a real watchdog before freezing the grace clock: socket I/O still runs in real time.
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`fallback did not settle within 10s; task status: ${store.load(task.task_id)?.status ?? "missing"}`)), 10_000)
      })
      // Keep both 50 ms close graces frozen until the real host confirms the close, so a slow
      // socket reply cannot turn the acknowledged case into an unconfirmed close (#9489).
      if (acknowledged) jest.useFakeTimers()

      try {
        // when
        host.emitRecord(original.routingId, { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "provider failed" } })
        host.emitRecord(original.routingId, { type: "agent_end", willRetry: false, messages: [] })
        host.emitRecord(original.routingId, { type: "agent_idle" })

        // then
        if (acknowledged) {
          await Promise.race([nextOpened, deadline])
          jest.useRealTimers()
          await bounded(drained.promise)
          expect(launched).toHaveLength(2)
          expect(store.load(task.task_id)?.pending_steering).toBeUndefined()
          expect(deliveries).toBe(2)
          expect(store.load(task.task_id)?.model).toBe("test/next")
          expect(host.commands.filter(command => command.type === "steer").map(command => command.payload.message)).toEqual(["Q1", "Q2"])
          expect(host.sessions().map((session) => session.sessionPath)).not.toContain(original.sessionPath)
        } else {
          if (settled === undefined) throw new Error("expected a terminal wait for the unconfirmed close")
          const record = await Promise.race([settled, deadline])
          expect(record.status).toBe("error")
          expect(launched).toHaveLength(1)
          expect(record.fallback_closing_child?.host_session?.session_path ?? record.host_session?.session_path).toBe(original.sessionPath)
        }
      } finally {
        if (acknowledged) jest.useRealTimers()
        clearTimeout(timeout)
        if (lateClose !== undefined) clearTimeout(lateClose)
        for (const handle of launched) await handle.dispose()
        for (const id of manager.residentTaskIds()) manager.forget(id, { path: "end" })
        lifecycle.dispose?.()
        manager.workpools.dispose()
      }
    })
  }
})
