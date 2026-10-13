import { describe, expect, it } from "bun:test"
import { toV1Events } from "./translate-events"

const noParents = { parentOf: () => undefined }
const at = () => 5_000

const event = (type: string, data: Record<string, unknown>) => ({ type, data })

describe("toV1Events", () => {
  describe("#given execution events", () => {
    it("#when execution starts #then the session reports busy", () => {
      // given / when
      const events = toV1Events(event("session.execution.started", { sessionID: "ses_1" }), noParents, at)

      // then
      expect(events).toEqual([{ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } }])
    })

    it("#when execution succeeds #then the session goes idle with status and idle events, in that order", () => {
      // given / when
      const events = toV1Events(event("session.execution.succeeded", { sessionID: "ses_1" }), noParents, at)

      // then
      expect(events).toEqual([
        { type: "session.status", properties: { sessionID: "ses_1", status: { type: "idle" } } },
        { type: "session.idle", properties: { sessionID: "ses_1" } },
      ])
    })

    it("#when execution fails #then session.error comes first, then idle", () => {
      // given
      const failed = event("session.execution.failed", { sessionID: "ses_1", error: { type: "provider.rate-limit", message: "Slow down", status: 429 } })

      // when
      const events = toV1Events(failed, noParents, at)

      // then
      expect(events.map((v1) => v1.type)).toEqual(["session.error", "session.status", "session.idle"])
      expect(events[0]?.properties).toEqual({
        sessionID: "ses_1",
        error: { name: "provider.rate-limit", data: { message: "Slow down", statusCode: 429 } },
      })
    })

    it("#when the user interrupts #then the 1.x aborted error precedes idle", () => {
      // given / when
      const events = toV1Events(event("session.execution.interrupted", { sessionID: "ses_1", reason: "user" }), noParents, at)

      // then
      expect(events.map((v1) => v1.type)).toEqual(["session.error", "session.status", "session.idle"])
      expect(events[0]?.properties).toEqual({ sessionID: "ses_1", error: { name: "MessageAbortedError", data: { message: "Aborted" } } })
    })

    it("#when the host interrupts for another reason #then the session just goes idle", () => {
      // given / when
      const events = toV1Events(event("session.execution.interrupted", { sessionID: "ses_1", reason: "superseded" }), noParents, at)

      // then
      expect(events.map((v1) => v1.type)).toEqual(["session.status", "session.idle"])
    })
  })

  describe("#given session lifecycle events", () => {
    it("#when a session is created #then session.created carries a 1.x info with directory and parent", () => {
      // given
      const created = event("session.created", {
        sessionID: "ses_2",
        projectID: "proj_1",
        location: { directory: "/work/app" },
        parentID: "ses_1",
        slug: "calm-river",
        title: "Explore",
        version: "2.0.28",
      })

      // when
      const events = toV1Events(created, noParents, at)

      // then
      expect(events).toEqual([
        {
          type: "session.created",
          properties: {
            info: {
              id: "ses_2",
              slug: "calm-river",
              projectID: "proj_1",
              directory: "/work/app",
              parentID: "ses_1",
              title: "Explore",
              version: "2.0.28",
              time: { created: 5_000, updated: 5_000 },
            },
          },
        },
      ])
    })

    it("#when a session is deleted #then session.deleted carries the parent the tracker knew", () => {
      // given
      const parents = { parentOf: (id: string) => (id === "ses_2" ? "ses_1" : undefined) }

      // when
      const events = toV1Events(event("session.deleted", { sessionID: "ses_2" }), parents, at)

      // then
      expect(events).toEqual([{ type: "session.deleted", properties: { info: { id: "ses_2", parentID: "ses_1" } } }])
    })

    it("#when compaction ends #then session.compacted is emitted", () => {
      // given / when
      const events = toV1Events(event("session.compaction.ended", { sessionID: "ses_1", reason: "auto" }), noParents, at)

      // then
      expect(events).toEqual([{ type: "session.compacted", properties: { sessionID: "ses_1" } }])
    })
  })

  describe("#given events with no 1.x counterpart or no session", () => {
    it("#when they arrive #then nothing is emitted", () => {
      // given / when / then
      expect(toV1Events({ type: "session.text.delta", data: { sessionID: "ses_1" } }, noParents, at)).toEqual([])
      expect(toV1Events({ type: "session.execution.started" }, noParents, at)).toEqual([])
      expect(toV1Events({ type: "session.execution.started", data: { sessionID: 3 } }, noParents, at)).toEqual([])
    })
  })
})
