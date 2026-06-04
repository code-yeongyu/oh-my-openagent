import { describe, expect, test } from "bun:test"
import {
  hasOutputSignalFromPart,
  resolveSessionNextPartInfo,
} from "./session-stream-activity"

describe("session.next stream activity", () => {
  test("#given text delta event #when resolving part info #then it counts as output activity", () => {
    // given
    const timestamp = "2026-05-21T03:00:00.000Z"

    // when
    const partInfo = resolveSessionNextPartInfo("session.next.text.delta", {
      sessionID: "ses-active",
      timestamp,
    })

    // then
    expect(partInfo?.type).toBe("text")
    expect(partInfo?.field).toBe("text")
    expect(partInfo?.activityTime).toEqual(new Date(timestamp))
    expect(hasOutputSignalFromPart(partInfo, "ses-active")).toBe(true)
  })

  test("#given metadata stream event #when resolving part info #then it refreshes activity without counting as output", () => {
    // given
    const timestamp = "2026-05-21T03:00:00.000Z"

    // when
    const partInfo = resolveSessionNextPartInfo("session.next.compaction.started", {
      sessionID: "ses-active",
      timestamp,
    })

    // then
    expect(partInfo?.type).toBeUndefined()
    expect(partInfo?.field).toBeUndefined()
    expect(partInfo?.activityTime).toEqual(new Date(timestamp))
    expect(hasOutputSignalFromPart(partInfo, "ses-active")).toBe(false)
  })
})
