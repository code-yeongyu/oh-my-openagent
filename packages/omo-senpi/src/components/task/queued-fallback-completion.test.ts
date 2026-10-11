import { afterEach, expect, test } from "bun:test"
import { createCompletionNotifier } from "../../../../senpi-task/src/completion/notifier"
import type { ParentNotifierMessage, ParentState } from "../../../../senpi-task/src/completion/types"
import { bounded } from "../../../../senpi-task/src/lifecycle/__fixtures__/live-parent-clock"
import { managerWithLifecycle, PRIMARY, stubbornChild } from "../../../../senpi-task/src/manager/__fixtures__/fallback-launch-fakes"
import { baseSpec, cleanupProjects, makeHandle, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import type { ManagedRunner } from "../../../../senpi-task/src/manager/types"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { createCompletionObservingStore } from "./completion-bridge"

afterEach(cleanupProjects)

for (const buffered of [false, true]) {
  test(`failed queued fallback delivers exactly one completion when ${buffered ? "buffered until resume" : "the parent is idle"}`, async () => {
    // Given a running process whose failed-rung teardown rejects, and a durable queue.
    const project = tempProject()
    const backing = createTaskRecordStore({ project_dir: project })
    const messages: ParentNotifierMessage[] = []
    let parentState: ParentState = buffered ? { kind: "session_shutdown" } : { kind: "idle" }
    const notifier = createCompletionNotifier({
      store: backing, notifier: { enqueue: message => messages.push(message) }, getCurrentSessionId: () => "parent-1",
    })
    const store = createCompletionObservingStore(backing, {
      notifier, parentState: () => parentState, wasBackground: () => true, currentSessionId: () => "parent-1",
    })
    const alive = new Set([3333])
    const starts: string[] = []
    let first: ReturnType<typeof makeHandle> | undefined
    const runner: ManagedRunner = {
      start: async spec => {
        starts.push(spec.model ?? "")
        first = makeHandle(spec.taskId, 3333)
        return { ...stubbornChild(spec.taskId, 3333), waitForOutcome: first.handle.waitForOutcome, subscribe: first.handle.subscribe }
      },
    }
    const h = managerWithLifecycle(store, runner, project, alive)
    const started = await h.manager.start(baseSpec({ execution_mode: "process", run_in_background: true }))
    if (started.kind !== "started" || first === undefined) throw new Error("setup failed")
    store.mutate(started.task_id, record => ({
      ...record, pending_steering: [{ id: "queued", message: "Q1", deliver_as: "steer" }],
    }))
    const completed = h.manager.waitFor(started.task_id, { signal: AbortSignal.timeout(5000) })
    try {
      // When runtime fallback cannot close its failed rung, and the real orphan cleanup finishes.
      first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
      const failed = await completed
      await bounded(h.orphaned)
      if (buffered) {
        expect(messages).toHaveLength(0)
        expect(notifier.bufferedCount("parent-1")).toBe(1)
        parentState = { kind: "idle" }
        notifier.flushBuffered({ sessionId: "parent-1", replaced: false })
      }

      // Then queue cleanup does not publish a second epoch of the same failure.
      expect(failed.status).toBe("error")
      expect(messages).toHaveLength(1)
      expect(store.load(started.task_id)?.notification.run_epoch).toBe(1)
      expect(store.load(started.task_id)?.pending_steering).toBeUndefined()
      expect(messages[0]?.customType).toBe("senpi-task.completion")
      expect(messages[0]?.content).toContain("1 queued message was not delivered.")
      expect(starts).toEqual([PRIMARY])
      expect(alive.size).toBe(0)
    } finally {
      h.lifecycle.dispose?.()
      h.manager.workpools.dispose()
    }
  })
}
