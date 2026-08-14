import type { TaskManager, TaskRecord } from "@oh-my-opencode/senpi-task"

import type { HerdrTaskClient, HerdrTaskPane } from "./herdr-command-client"

export type ProjectionTaskManager = Pick<TaskManager, "list" | "subscribeChild">

export type ProjectionOptions = {
  readonly manager: ProjectionTaskManager
  readonly client: HerdrTaskClient
  readonly workspaceId: string
  readonly cwd: string
  readonly parentSessionId: () => string | undefined
  readonly onError: (error: unknown) => void
  readonly includeAssistantOutput?: boolean
}

export type ProjectedTask = HerdrTaskPane & {
  readonly taskId: string
  unsubscribe: () => void
  sequence: number
  reportFailures: number
  signature: string
}

export type TaskSnapshot = {
  readonly generation: number
  readonly records: readonly TaskRecord[]
}

export type HerdrTaskProjection = {
  scheduleSync(): void
  syncNow(): Promise<void>
  flush(): Promise<void>
  resume(): void
  clear(): Promise<void>
  dispose(): Promise<void>
}
