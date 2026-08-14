import type { TaskRecord } from "@oh-my-opencode/senpi-task"

import type { HerdrTaskPane } from "./herdr-command-client"
import {
  childEventLine,
  taskAgentType,
  taskReport,
  taskSignature,
  taskTitle,
} from "./herdr-task-format"
import type {
  HerdrTaskProjection,
  ProjectedTask,
  ProjectionOptions,
  TaskSnapshot,
} from "./herdr-task-projection-types"

export type { HerdrTaskProjection } from "./herdr-task-projection-types"

class TaskProjection implements HerdrTaskProjection {
  readonly #tasks = new Map<string, ProjectedTask>()
  readonly #orphanTabs = new Set<string>()
  #tail: Promise<void> = Promise.resolve()
  #paused = false
  #disposed = false
  #generation = 0

  constructor(private readonly options: ProjectionOptions) {}

  scheduleSync(): void {
    if (this.#paused || this.#disposed) return
    const snapshot = this.#snapshot()
    void this.#enqueue(() => this.#reconcile(snapshot))
  }

  syncNow(): Promise<void> {
    if (this.#paused || this.#disposed) return this.#tail
    const snapshot = this.#snapshot()
    return this.#enqueue(() => this.#reconcile(snapshot))
  }

  flush(): Promise<void> {
    return this.#tail
  }

  resume(): void {
    if (this.#disposed) return
    if (this.#paused) this.#generation += 1
    this.#paused = false
    this.scheduleSync()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return this.#tail
    this.#disposed = true
    this.#paused = true
    this.#generation += 1
    await this.#enqueue(() => this.#clear())
  }

  async clear(): Promise<void> {
    if (this.#disposed) return this.#tail
    this.#paused = true
    this.#generation += 1
    await this.#enqueue(() => this.#clear())
  }

  async #clear(): Promise<void> {
    for (const task of this.#tasks.values()) task.unsubscribe()
    for (const task of [...this.#tasks.values()].reverse()) {
      await this.#bestEffort(() => this.options.client.releaseTask(
        task.paneId,
        task.taskId,
        ++task.sequence,
      ))
      if (!(await this.#closeTab(task.tabId))) this.#orphanTabs.add(task.tabId)
      this.#tasks.delete(task.taskId)
    }
    await this.#drainOrphanTabs()
  }

  #snapshot(): TaskSnapshot {
    const parentSessionId = this.options.parentSessionId()
    if (parentSessionId === undefined) return { generation: this.#generation, records: [] }
    const records = this.options.manager
      .list({ scope: "parent-session", session_id: parentSessionId })
      .map(({ record }) => record)
      .filter((record) =>
        record.parent_session_id === parentSessionId
        && record.execution_mode === "in-process"
      )
    return { generation: this.#generation, records }
  }

  async #reconcile(snapshot: TaskSnapshot): Promise<void> {
    if (!this.#isCurrent(snapshot.generation)) return
    await this.#drainOrphanTabs()
    if (!this.#isCurrent(snapshot.generation)) return

    for (const record of snapshot.records) {
      if (!this.#isCurrent(snapshot.generation)) return
      const projected = this.#tasks.get(record.task_id)
      if (projected === undefined) {
        if (record.status !== "running") continue
        await this.#create(record, snapshot.generation)
        continue
      }
      const nextSignature = taskSignature(record)
      if (nextSignature === projected.signature) continue
      const sequence = ++projected.sequence
      try {
        await this.options.client.reportTask(taskReport(record, projected.paneId, sequence))
      } catch (error) {
        this.options.onError(error)
        projected.reportFailures += 1
        if (projected.reportFailures <= 2 && this.#isCurrent(snapshot.generation)) {
          const retry = this.#snapshot()
          void this.#enqueue(() => this.#reconcile(retry))
        }
        continue
      }
      projected.reportFailures = 0
      if (!this.#isCurrent(snapshot.generation)) return
      await this.options.client.writeLine(
        projected.paneId,
        `[${record.status}] ${taskAgentType(record)} ${record.task_id} - ${taskTitle(record)}`,
      )
      projected.signature = nextSignature
    }
  }

  async #create(record: TaskRecord, generation: number): Promise<void> {
    const bufferedLines: string[] = []
    let liveTask: ProjectedTask | undefined
    let pane: HerdrTaskPane | undefined
    const unsubscribe = this.options.manager.subscribeChild(record.task_id, (event) => {
      const line = childEventLine(event, this.options.includeAssistantOutput === true)
      if (
        line === undefined
        || this.#paused
        || this.#disposed
        || generation !== this.#generation
      ) return
      const task = liveTask
      if (task === undefined) {
        if (bufferedLines.length < 100) bufferedLines.push(line)
        return
      }
      void this.#enqueue(() => this.options.client.writeLine(task.paneId, line))
    })
    try {
      const createdPane = await this.options.client.createTaskPane({
        workspaceId: this.options.workspaceId,
        cwd: this.options.cwd,
        label: `${taskAgentType(record)} - ${record.task_id}`,
        taskId: record.task_id,
      })
      pane = createdPane
      if (!this.#isCurrent(generation)) {
        unsubscribe()
        if (!(await this.#closeTab(createdPane.tabId))) this.#orphanTabs.add(createdPane.tabId)
        return
      }
      const task: ProjectedTask = {
        ...createdPane,
        taskId: record.task_id,
        sequence: 1,
        reportFailures: 0,
        signature: taskSignature(record),
        unsubscribe,
      }
      liveTask = task
      await this.options.client.writeLine(
        createdPane.paneId,
        `[running] ${taskAgentType(record)} ${record.task_id} - ${taskTitle(record)}`,
      )
      for (const line of bufferedLines) await this.options.client.writeLine(createdPane.paneId, line)
      await this.options.client.startViewer(createdPane.paneId)
      if (!this.#isCurrent(generation)) {
        unsubscribe()
        if (!(await this.#closeTab(createdPane.tabId))) this.#orphanTabs.add(createdPane.tabId)
        return
      }
      await this.options.client.reportTask(taskReport(record, createdPane.paneId, task.sequence))
      if (!this.#isCurrent(generation)) {
        unsubscribe()
        await this.#bestEffort(() => this.options.client.releaseTask(
          createdPane.paneId,
          record.task_id,
          2,
        ))
        if (!(await this.#closeTab(createdPane.tabId))) this.#orphanTabs.add(createdPane.tabId)
        return
      }
      this.#tasks.set(record.task_id, task)
    } catch (error) {
      unsubscribe()
      if (pane === undefined) throw error
      const failedPane = pane
      await this.#bestEffort(() => this.options.client.releaseTask(
        failedPane.paneId,
        record.task_id,
        2,
      ))
      if (!(await this.#closeTab(failedPane.tabId))) this.#orphanTabs.add(failedPane.tabId)
      throw error
    }
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    this.#tail = this.#tail
      .then(operation)
      .catch((error: unknown) => {
        this.options.onError(error)
      })
    return this.#tail
  }

  #isCurrent(generation: number): boolean {
    return !this.#paused && !this.#disposed && generation === this.#generation
  }

  async #drainOrphanTabs(): Promise<void> {
    for (const tabId of [...this.#orphanTabs]) {
      if (await this.#closeTab(tabId)) this.#orphanTabs.delete(tabId)
    }
  }

  async #closeTab(tabId: string): Promise<boolean> {
    try {
      await this.options.client.closeTab(tabId)
      return true
    } catch (error) {
      this.options.onError(error)
      return false
    }
  }

  async #bestEffort(operation: () => Promise<void>): Promise<void> {
    try {
      await operation()
    } catch (error) {
      this.options.onError(error)
    }
  }
}

export function createHerdrTaskProjection(options: ProjectionOptions): HerdrTaskProjection {
  return new TaskProjection(options)
}
