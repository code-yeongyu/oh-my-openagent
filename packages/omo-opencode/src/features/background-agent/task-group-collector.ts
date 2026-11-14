import {
  buildBackgroundTaskNotificationText,
  buildTaskGroupNotificationText,
  type BackgroundTaskNotificationInput,
} from "./background-task-notification-template"
import type { BackgroundTask } from "./types"

type TaskGroup = {
  size: number
  readonly parentSessionId: string
  readonly members: BackgroundTaskNotificationInput[]
  lastTask?: BackgroundTask
}

/** What the manager does with a finished task's notice. */
export type GroupedNotice = { readonly kind: "deliver"; readonly notification: string } | { readonly kind: "hold" }

/**
 * Holds a fan-out group's finished members until the last one is done, then hands back one notice built from all of
 * them, so a `task` call with `items` reports once with every child's result.
 */
export class TaskGroupCollector {
  private readonly groups = new Map<string, TaskGroup>()

  register(groupId: string, input: { readonly size: number; readonly parentSessionId: string }): void {
    this.groups.set(groupId, { size: input.size, parentSessionId: input.parentSessionId, members: [] })
  }

  isGrouped(task: Pick<BackgroundTask, "groupId">): boolean {
    return task.groupId !== undefined && this.groups.has(task.groupId)
  }

  collect(task: BackgroundTask, notice: BackgroundTaskNotificationInput): GroupedNotice {
    const group = task.groupId ? this.groups.get(task.groupId) : undefined
    if (!task.groupId || !group) return { kind: "deliver", notification: buildBackgroundTaskNotificationText(notice) }
    group.members.push(notice)
    group.lastTask = task
    return this.release(task.groupId, group) ?? { kind: "hold" }
  }

  /**
   * Fixes the group's size once its launches are done: children that failed to launch never report. Returns the
   * combined notice, with the member to deliver it for, when every launched member had already finished.
   */
  settleSize(
    groupId: string,
    size: number,
  ): { readonly task: BackgroundTask; readonly notification: string } | undefined {
    const group = this.groups.get(groupId)
    if (!group) return undefined
    if (size <= 0) {
      this.groups.delete(groupId)
      return undefined
    }
    group.size = size
    const released = this.release(groupId, group)
    return released?.kind === "deliver" && group.lastTask
      ? { task: group.lastTask, notification: released.notification }
      : undefined
  }

  clear(): void {
    this.groups.clear()
  }

  private release(groupId: string, group: TaskGroup): GroupedNotice | undefined {
    if (group.members.length < group.size) return undefined
    this.groups.delete(groupId)
    return { kind: "deliver", notification: buildTaskGroupNotificationText(groupId, group.members) }
  }
}
