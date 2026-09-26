import { describe, expect, it } from "bun:test"
import { createEventBus } from "./event-bus"
import type { V2EventDomain } from "./event-bus"
import { createStatusCache } from "./stores"

function buildEventDomain(events: unknown[]): V2EventDomain {
  return {
    subscribe: async function* () {
      for (const event of events) yield event as never
    },
  } as unknown as V2EventDomain
}

describe("#given event bus over a scripted stream", () => {
  describe("#when running to completion", () => {
    it("#then dispatches by type and feeds the status cache", async () => {
      // given
      const statusCache = createStatusCache()
      const bus = createEventBus(
        buildEventDomain([
          { type: "session.execution.started", data: { sessionID: "ses-1" } },
          { type: "session.idle", data: { sessionID: "ses-1" } },
          { type: "session.status", data: { sessionID: "ses-2", status: { type: "retry" } } },
        ]),
        statusCache,
      )
      const seen: string[] = []
      bus.on("session.idle", (event) => {
        seen.push((event as { type: string }).type)
      })
      const off = bus.on("session.idle", () => {})
      off()

      // when
      await bus.run(new AbortController().signal)

      // then
      expect(seen).toEqual(["session.idle"])
      expect(statusCache.get("ses-1")).toBe("idle")
      expect(statusCache.get("ses-2")).toBe("retry")
    })
  })
})
