/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import {
  clearBackgroundOutputConsumptionState,
  clearBackgroundOutputConsumptionsForParentSession,
  clearBackgroundOutputConsumptionsForTaskSession,
  isBackgroundTaskOutputConsumption,
  recordBackgroundOutputConsumption,
  recordBackgroundTaskOutputConsumption,
  restoreBackgroundOutputConsumption,
} from "./background-output-consumption"
import {
  consumeNewMessages,
  getMessageCursor,
  resetMessageCursor,
} from "./session-cursor"

afterEach(() => {
  clearBackgroundOutputConsumptionState()
  resetMessageCursor()
})

describe("recordBackgroundTaskOutputConsumption + isBackgroundTaskOutputConsumption", () => {
  test("#given a consumed task recorded with both taskID and taskSessionID #when queried by either alias #then both match and both-together match", () => {
    // #given
    recordBackgroundTaskOutputConsumption({
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      taskID: "bg_abc",
      taskSessionID: "ses_xyz",
    })

    // #when #then
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskID: "bg_abc" })
    ).toBe(true)
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskSessionID: "ses_xyz" })
    ).toBe(true)
    expect(
      isBackgroundTaskOutputConsumption({
        parentSessionID: "parent-1",
        taskID: "bg_abc",
        taskSessionID: "ses_xyz",
      })
    ).toBe(true)
  })

  test("#given a consumed task recorded with only taskSessionID #when queried #then session matches and taskID does not", () => {
    // #given
    recordBackgroundTaskOutputConsumption({
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      taskID: undefined,
      taskSessionID: "ses_only",
    })

    // #when #then
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskSessionID: "ses_only" })
    ).toBe(true)
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskID: "bg_anything" })
    ).toBe(false)
  })

  test("#given a consumed task recorded with only taskID #when queried #then taskID matches and session does not", () => {
    // #given
    recordBackgroundTaskOutputConsumption({
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      taskID: "bg_only",
      taskSessionID: undefined,
    })

    // #when #then
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskID: "bg_only" })
    ).toBe(true)
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskSessionID: "ses_anything" })
    ).toBe(false)
  })

  test("#given a consumed task under one parent #when queried with a different parentSessionID #then returns false (suppression is parent-scoped)", () => {
    // #given
    recordBackgroundTaskOutputConsumption({
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      taskID: "bg_abc",
      taskSessionID: "ses_xyz",
    })

    // #when #then
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-other", taskID: "bg_abc" })
    ).toBe(false)
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-other", taskSessionID: "ses_xyz" })
    ).toBe(false)
  })

  test("#given consumed markers recorded under a message #when restoreBackgroundOutputConsumption removes that message #then query returns false", () => {
    // #given
    recordBackgroundTaskOutputConsumption({
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      taskID: "bg_abc",
      taskSessionID: "ses_xyz",
    })
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskID: "bg_abc" })
    ).toBe(true)

    // #when
    restoreBackgroundOutputConsumption("parent-1", "msg-1")

    // #then
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskID: "bg_abc" })
    ).toBe(false)
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskSessionID: "ses_xyz" })
    ).toBe(false)
  })

  test("#given consumed markers under a parent #when clearBackgroundOutputConsumptionsForParentSession runs #then markers for that parent are gone but other parents keep theirs", () => {
    // #given
    recordBackgroundTaskOutputConsumption({
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      taskID: "bg_abc",
      taskSessionID: "ses_xyz",
    })
    recordBackgroundTaskOutputConsumption({
      parentSessionID: "parent-2",
      parentMessageID: "msg-2",
      taskID: "bg_def",
      taskSessionID: "ses_uvw",
    })

    // #when
    clearBackgroundOutputConsumptionsForParentSession("parent-1")

    // #then
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskID: "bg_abc" })
    ).toBe(false)
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-2", taskID: "bg_def" })
    ).toBe(true)
  })

  test("#given a consumed task paired by taskID and taskSessionID #when clearBackgroundOutputConsumptionsForTaskSession clears that session #then both the session alias and the paired taskID stop suppressing", () => {
    // #given
    recordBackgroundTaskOutputConsumption({
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      taskID: "bg_paired",
      taskSessionID: "ses_paired",
    })
    recordBackgroundTaskOutputConsumption({
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      taskID: "bg_keep",
      taskSessionID: "ses_keep",
    })

    // #when
    clearBackgroundOutputConsumptionsForTaskSession("ses_paired")

    // #then
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskSessionID: "ses_paired" })
    ).toBe(false)
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskID: "bg_paired" })
    ).toBe(false)
    expect(
      isBackgroundTaskOutputConsumption({ parentSessionID: "parent-1", taskID: "bg_keep" })
    ).toBe(true)
  })

  test("#given cursor snapshot recorded via the legacy helper #when the message is restored #then the message cursor is restored to the snapshot (undo regression guard)", () => {
    // #given a task session cursor is advanced once, then snapshotted via the legacy recorder
    const taskSessionID = "ses_cursor"
    consumeNewMessages(taskSessionID, [{ info: { id: "m1" } }])
    const beforeSnapshot = getMessageCursor(taskSessionID)
    recordBackgroundOutputConsumption("parent-1", "msg-undo", taskSessionID)

    // #when the cursor advances further, then the parent message is removed (undo)
    consumeNewMessages(taskSessionID, [
      { info: { id: "m1" } },
      { info: { id: "m2" } },
    ])
    expect(getMessageCursor(taskSessionID)?.lastKey).not.toBe(beforeSnapshot?.lastKey)
    restoreBackgroundOutputConsumption("parent-1", "msg-undo")

    // #then the cursor is restored to the snapshotted state
    expect(getMessageCursor(taskSessionID)).toEqual(beforeSnapshot)
  })
})
