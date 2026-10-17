import { describe, expect, test } from "bun:test"
import { toV1Event } from "./event-bridge"

describe("toV1Event", () => {
  test("#given a V2 session.idle event #when translated #then properties carry the sessionID", () => {
    // given
    const v2Event = {
      id: "evt_1",
      created: 1234,
      type: "session.idle",
      data: { sessionID: "ses_123" },
    }
    // when
    const v1Event = toV1Event(v2Event)
    // then
    expect(v1Event).not.toBeNull()
    expect(v1Event?.type).toBe("session.idle")
    expect(v1Event?.properties?.["sessionID"]).toBe("ses_123")
  })

  test("#given a V2 session.execution.failed event #when translated #then it becomes V1 session.error", () => {
    // given
    const v2Event = {
      id: "evt_2",
      created: 1234,
      type: "session.execution.failed",
      data: { sessionID: "ses_err", error: { message: "provider exploded" } },
    }
    // when
    const v1Event = toV1Event(v2Event)
    // then
    expect(v1Event?.type).toBe("session.error")
    expect(v1Event?.properties?.["sessionID"]).toBe("ses_err")
    expect((v1Event?.properties?.["error"] as Record<string, unknown>)["message"]).toBe(
      "provider exploded",
    )
  })

  test("#given an event with no type #when translated #then it is dropped", () => {
    // given
    const v2Event = { id: "evt_3", created: 1, data: {} }
    // when
    const v1Event = toV1Event(v2Event)
    // then
    expect(v1Event).toBeNull()
  })

  test("#given an event whose data is not an object #when translated #then properties default to {}", () => {
    // given
    const v2Event = { id: "evt_4", created: 1, type: "session.created", data: undefined }
    // when
    const v1Event = toV1Event(v2Event)
    // then
    expect(v1Event?.type).toBe("session.created")
    expect(v1Event?.properties).toEqual({})
  })

  test("#given a session.created event with metadata #when translated #then type is preserved and metadata merges", () => {
    // given
    const v2Event = {
      id: "evt_5",
      created: 1,
      type: "session.created",
      data: { sessionID: "ses_new" },
      metadata: { source: "tui" },
    }
    // when
    const v1Event = toV1Event(v2Event)
    // then
    expect(v1Event?.type).toBe("session.created")
    expect(v1Event?.properties?.["sessionID"]).toBe("ses_new")
    expect(v1Event?.properties?.["source"]).toBe("tui")
  })
})
