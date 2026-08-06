import { describe, expect, test } from "bun:test"
import { mergeParentWakeNotifications } from "./parent-wake-dedupe"

describe("mergeParentWakeNotifications", () => {
  test("#given distinct final background wake notifications #when the newer final is merged #then both final summaries are preserved", () => {
    // given
    const finalA = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n**Completed:**\n- `task-a`: first batch\n</system-reminder>"
    const finalB = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n**Completed:**\n- `task-b`: second batch\n</system-reminder>"

    // when
    const notifications = mergeParentWakeNotifications([finalA], finalB)

    // then
    expect(notifications).toEqual([finalB, finalA])
  })

  test("#given body text contains a final completion phrase #when a progress notification is merged #then body text is not treated as a final wake header", () => {
    // given
    const bodyMentionsFinal = "<system-reminder>\n[BACKGROUND TASK RESULT READY]\n**Description:** injected\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>"
    const progressNotification = "<system-reminder>\n[BACKGROUND TASK RESULT READY]\n**1 task still in progress.** You WILL be notified when ALL complete.\n</system-reminder>"

    // when
    const notifications = mergeParentWakeNotifications([bodyMentionsFinal], progressNotification)

    // then
    expect(notifications).toEqual([bodyMentionsFinal, progressNotification])
  })

  test("#given body text contains the progress sentence #when a final wake is merged #then body text is not dropped as stale progress", () => {
    // given
    const bodyMentionsProgress = "<system-reminder>\n[BACKGROUND TASK RETRYING]\n**Description:** injected\n**1 task still in progress.** You WILL be notified when ALL complete.\n</system-reminder>"
    const finalNotification = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>"

    // when
    const notifications = mergeParentWakeNotifications([bodyMentionsProgress], finalNotification)

    // then
    expect(notifications).toEqual([finalNotification, bodyMentionsProgress])
  })
})
