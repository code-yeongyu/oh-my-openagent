import { describe, expect, test } from "bun:test"
import {
  hasOutputSignalFromPart,
  isInternalInitiatorTextPart,
  resolveMessagePartInfo,
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

  test("#given internal user wake part #when resolving part info #then internal signal is exposed", () => {
    // given
    const properties = {
      sessionID: "ses-parent",
      part: {
        sessionID: "ses-parent",
        type: "text",
        text: "<system-reminder>done</system-reminder>\n<!-- OMO_INTERNAL_INITIATOR -->",
      },
    }

    // when
    const partInfo = resolveMessagePartInfo(properties)

    // then
    expect(partInfo?.text).toContain("OMO_INTERNAL_INITIATOR")
    expect(hasOutputSignalFromPart(partInfo, "ses-parent")).toBe(true)
    expect(isInternalInitiatorTextPart(partInfo, "ses-parent")).toBe(true)
  })
})
