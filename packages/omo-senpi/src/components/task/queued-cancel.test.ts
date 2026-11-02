import { afterEach, expect, spyOn, test } from "bun:test"
import { coldReviveHarness } from "../../../../senpi-task/src/lifecycle/__fixtures__/cold-revive-harness"
import { cleanupProjects } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { runTaskCancel } from "../../../../senpi-task/src/tools/control/cancel"
import { renderTaskCancelResult } from "../../../../senpi-task/src/tools/control/renderers"
import { withDroppedSteeringNotice } from "../../../../senpi-task/src/state/queued-steering"

afterEach(cleanupProjects)

for (const resident of [true, false]) {
  test(`task_cancel drops and reports a finished ${resident ? "resident" : "parked"} child's queue`, async () => {
    const h = coldReviveHarness()
    const events = spyOn(h.store, "appendEvent")
    try {
      if (resident) {
        await h.send()
        const terminal = h.manager.waitFor(h.record.task_id, { signal: AbortSignal.timeout(2000) })
        h.fake.settle({ status: "completed", finalResponse: "DONE" })
        await terminal
      }
      h.store.mutate(h.record.task_id, record => ({ ...record, pending_steering: [
        { id: "cancel-1", message: "Q1", deliver_as: "steer" },
        { id: "cancel-2", message: "Q2", deliver_as: "steer" },
      ] }))

      const result = await runTaskCancel(h.manager, { task_id: h.record.task_id })

      expect(result.details).toMatchObject({ kind: "released", undelivered_messages: 2 })
      expect(h.store.load(h.record.task_id)?.pending_steering).toBeUndefined()
      expect(events.mock.calls.filter(([, event]) => event.type === "steer_dropped").map(([, event]) => event.payload))
        .toEqual([{ count: 2, reason: "cancelled" }])
      const notice = withDroppedSteeringNotice("", 2).trim()
      expect(result.content.filter(part => part.type === "text").map(part => part.text).join("\n")).toContain(notice)
      expect(renderTaskCancelResult(result, { expanded: false, isPartial: false },
        { fg: (_color, text) => text, italic: text => text }).render(200).join("\n")).toContain(notice)
      expect((await h.send("NEW_REQUEST")).kind).toBe("revived")
      expect(h.fake.followUpCalls.at(-1)).toBe("NEW_REQUEST")
    } finally {
      await h.dispose()
    }
  })
}
