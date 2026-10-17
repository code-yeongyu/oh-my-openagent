import { afterEach, expect, spyOn, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isColdRevivalCandidate } from "../lifecycle/revive-policy"
import { newestSessionPath } from "../lifecycle/session-path"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { bounded } from "../lifecycle/__fixtures__/live-parent-clock"
import { withDroppedSteeringNotice } from "../state/queued-steering"
import { describeStartFailure } from "./start-failure"
import { baseSpec, cleanupProjects, makeManager, settings } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

for (const transcript of [false, true]) {
  test(`failed queued launch ${transcript ? "parks a resumable transcript" : "reports its permanently missing target"}`, async () => {
    const h = makeManager({ config: settings({ default_concurrency: 1, global_concurrency: 0 }) })
    const first = await h.manager.start(baseSpec())
    const second = await h.manager.start(baseSpec())
    if (first.kind !== "started" || second.kind !== "started") throw new Error("fixture did not start")
    expect(second.status).toBe("pending")
    expect((await h.manager.sendToTask({ idOrName: second.task_id, message: "Q1" })).kind).toBe("queued")
    if (transcript) {
      const dir = resolveChildSessionDir(join(h.store.stateDir, "children", second.task_id), second.task_id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "started.jsonl"), `${JSON.stringify({
        type: "session", version: 3, id: "queued-start", timestamp: new Date(0).toISOString(), cwd: h.project,
      })}\n`)
    }
    const finished = Promise.withResolvers<void>()
    const append = h.store.appendEvent.bind(h.store)
    const events = spyOn(h.store, "appendEvent").mockImplementation((id, event) => {
      const result = append(id, event)
      if (id === second.task_id && event.type === "task_start_failed") finished.resolve()
      return result
    })
    h.inProcess.startError = new Error("runner could not start")
    const firstHandle = h.inProcess.handles.get(first.task_id)
    if (firstHandle === undefined) throw new Error("fixture has no first handle")
    await bounded(firstHandle.waitForSubscription())
    firstHandle.settle({ status: "completed", finalResponse: "DONE" })
    await bounded(finished.promise)
    const record = h.store.load(second.task_id)
    if (record === null) throw new Error("failed record vanished")
    expect(record.status).toBe("error")
    if (transcript) {
      expect(record.pending_steering?.map(entry => entry.message)).toEqual(["Q1"])
      expect(isColdRevivalCandidate(record)).toBe(true)
      expect(newestSessionPath({ store: h.store }, second.task_id)).toBeDefined()
      expect(events.mock.calls.filter(([, event]) => event.type === "steer_dropped")).toEqual([])
    } else {
      expect(record.pending_steering).toBeUndefined()
      expect(record.error_message).toBe(withDroppedSteeringNotice(describeStartFailure(h.inProcess.startError).errorMessage, 1))
      expect(events.mock.calls.find(([id, event]) => id === second.task_id && event.type === "task_start_failed")?.[1].payload)
        .toMatchObject({ error_message: record.error_message })
      expect(events.mock.calls.filter(([, event]) => event.type === "steer_dropped").map(([, event]) => event.payload))
        .toEqual([{ count: 1, reason: "target_gone" }])
    }
  })
}
