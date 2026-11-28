import { describe, expect, test } from "bun:test"
import {
  buildBackgroundTaskNotificationText,
  type BackgroundTaskNotificationInput,
} from "./background-task-notification-template"
import { isFailureParentWake } from "./parent-wake-dedupe"
import { TaskGroupCollector } from "./task-group-collector"
import type { BackgroundTask } from "./types"

function member(id: string): BackgroundTask {
  return {
    id,
    groupId: "grp_1",
    parentSessionId: "ses_parent",
    parentMessageId: "msg",
    description: id,
    prompt: "",
    agent: "explore",
    status: "completed",
  }
}

function notice(id: string, overrides: Partial<BackgroundTaskNotificationInput> = {}): BackgroundTaskNotificationInput {
  return {
    task: { id, sessionId: `ses_${id}`, description: id, status: "completed" },
    duration: "5s",
    statusText: "COMPLETED",
    allComplete: false,
    remainingCount: 1,
    result: { text: `answer of ${id}`, truncated: false },
    grouped: true,
    ...overrides,
  }
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe("TaskGroupCollector", () => {
  test("#given a group of two #when the first member finishes #then its notice is held", () => {
    // given
    const groups = new TaskGroupCollector()
    groups.register("grp_1", { size: 2, parentSessionId: "ses_parent" })

    // when
    const first = groups.collect(member("bg_a"), notice("bg_a"))

    // then
    expect(first.kind).toBe("hold")
  })

  test("#given a group of two #when the last member finishes #then one notice carries both members' results in finishing order", () => {
    // given
    const groups = new TaskGroupCollector()
    groups.register("grp_1", { size: 2, parentSessionId: "ses_parent" })
    groups.collect(member("bg_b"), notice("bg_b"))

    // when
    const last = groups.collect(member("bg_a"), notice("bg_a", { allComplete: true, remainingCount: 0 }))

    // then
    expect(last.kind).toBe("deliver")
    const text = last.kind === "deliver" ? last.notification : ""
    expect(text).toContain("[BACKGROUND TASK GROUP COMPLETE]")
    expect(text).toContain("[ALL BACKGROUND TASKS COMPLETE]")
    expect(text).toContain("<group-id>grp_1</group-id>")
    expect(count(text, "<system-reminder>")).toBe(1)
    expect(count(text, "<task-notification>")).toBe(1)
    expect(count(text, "<task>")).toBe(2)
    expect(text).toContain("answer of bg_a")
    expect(text).toContain("answer of bg_b")
    expect(text.indexOf("<task-id>bg_b</task-id>")).toBeLessThan(text.indexOf("<task-id>bg_a</task-id>"))
    expect(text).not.toContain("[BACKGROUND TASK COMPLETED]")
    expect(groups.isGrouped(member("bg_a"))).toBe(false)
  })

  test("#given a member failed #when the group is released #then its wake reads as a failure", () => {
    // given
    const groups = new TaskGroupCollector()
    groups.register("grp_1", { size: 2, parentSessionId: "ses_parent" })
    groups.collect(member("bg_a"), notice("bg_a"))

    // when
    const last = groups.collect(
      member("bg_b"),
      notice("bg_b", {
        statusText: "ERROR",
        task: { id: "bg_b", sessionId: "ses_bg_b", description: "bg_b", status: "error", error: "boom" },
        result: undefined,
      }),
    )

    // then
    const text = last.kind === "deliver" ? last.notification : ""
    expect(text).toContain("<error>boom</error>")
    expect(
      isFailureParentWake({ notifications: [text], shouldReply: true } as Parameters<typeof isFailureParentWake>[0]),
    ).toBe(true)
  })

  test("#given a child failed to launch #when the size settles below what already finished #then the group is released", () => {
    // given
    const groups = new TaskGroupCollector()
    groups.register("grp_1", { size: 3, parentSessionId: "ses_parent" })
    groups.collect(member("bg_a"), notice("bg_a"))
    groups.collect(member("bg_b"), notice("bg_b"))

    // when
    const ready = groups.settleSize("grp_1", 2)

    // then
    expect(ready?.task.id).toBe("bg_b")
    expect(ready?.notification).toContain("answer of bg_a")
    expect(ready?.notification).toContain("answer of bg_b")
  })

  test("#given a task outside any group #when it finishes #then its own notice is delivered", () => {
    const groups = new TaskGroupCollector()
    const solo = notice("bg_x", { grouped: false })
    expect(groups.collect({ ...member("bg_x"), groupId: undefined }, solo)).toEqual({
      kind: "deliver",
      notification: buildBackgroundTaskNotificationText(solo),
    })
  })
})
