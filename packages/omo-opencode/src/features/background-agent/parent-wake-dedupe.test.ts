import { describe, expect, test } from "bun:test"
import { mergeParentWakeNotifications } from "./parent-wake-dedupe"

describe("mergeParentWakeNotifications", () => {
  test("#given two task notices #when the second is merged #then both are kept in arrival order", () => {
    // given
    const noticeA = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n<task-id>bg_a</task-id>\n</system-reminder>"
    const noticeB =
      "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n<task-id>bg_b</task-id>\n</system-reminder>"

    // when
    const notifications = mergeParentWakeNotifications([noticeA], noticeB)

    // then
    expect(notifications).toEqual([noticeA, noticeB])
  })

  test("#given an identical notice is already pending #when it is merged again #then it appears once", () => {
    // given
    const notice = "<system-reminder>\n[BACKGROUND TASK ERROR]\n<task-id>bg_a</task-id>\n</system-reminder>"

    // when
    const notifications = mergeParentWakeNotifications([notice], notice)

    // then
    expect(notifications).toEqual([notice])
  })
})
