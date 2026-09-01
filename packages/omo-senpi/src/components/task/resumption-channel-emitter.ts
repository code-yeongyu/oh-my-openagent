import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import {
  isOwnedTeamMemberTask,
  type ListScope,
  type ListedTask,
  type StateDirConfig,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import { isTerminal, taskStatusDescription } from "./status-row-format"

export const RESUMPTION_CHANNEL_STATE_EVENT = "wake_source_state"
const RESUMPTION_CHANNEL_SOURCE = "senpi-task"

type ResumptionChannel = {
  readonly id: string
  readonly description: string
  readonly startedAtMs: number
}

type ResumptionChannelEmitterManager = {
  list(scope: ListScope): readonly ListedTask[]
  wasBackground(taskId: string): boolean
}

type OwnedTeamMemberResolver = (
  record: TaskRecord,
  sessionId: string | undefined,
  deps: { readonly stateDir: StateDirConfig; readonly taskSettings: OmoTaskSettings },
) => Promise<boolean>

export type ResumptionChannelEmitter = {
  emitIfChanged(): Promise<void>
  emitSessionStart(): Promise<void>
  emitShutdown(): Promise<void>
}

export type ResumptionChannelEmitterDeps = {
  readonly pi: SenpiExtensionAPI
  readonly manager: ResumptionChannelEmitterManager
  readonly sessionId: () => string | undefined
  readonly stateDir: StateDirConfig
  readonly settings: OmoTaskSettings
  readonly isOwnedTeamMember?: OwnedTeamMemberResolver
}

export function createResumptionChannelEmitter(
  deps: ResumptionChannelEmitterDeps,
): ResumptionChannelEmitter {
  const resolveOwnedTeamMember = deps.isOwnedTeamMember ?? isOwnedTeamMemberTask
  let active = false
  let lastCount = 0
  let pending = Promise.resolve()

  function enqueue(operation: () => Promise<void> | void): Promise<void> {
    pending = pending.then(operation, operation)
    return pending
  }

  async function snapshot(): Promise<readonly ResumptionChannel[]> {
    const sessionId = deps.sessionId()
    if (sessionId === undefined) return []
    const channels: ResumptionChannel[] = []
    for (const { record } of deps.manager.list({ scope: "parent-session", session_id: sessionId })) {
      if (isTerminal(record.status)) continue
      const background = deps.manager.wasBackground(record.task_id)
      const owned = background
        ? false
        : await resolveOwnedTeamMember(record, sessionId, {
            stateDir: deps.stateDir,
            taskSettings: deps.settings,
          })
      if (!background && !owned) continue
      channels.push({
        id: record.task_id,
        description: taskStatusDescription(record),
        startedAtMs: Date.parse(record.created_at),
      })
    }
    return channels
  }

  function publish(channels: readonly ResumptionChannel[]): void {
    lastCount = channels.length
    deps.pi.events?.emit(RESUMPTION_CHANNEL_STATE_EVENT, {
      source: RESUMPTION_CHANNEL_SOURCE,
      activeCount: channels.length,
      channels,
    })
  }

  return {
    emitIfChanged: () => enqueue(async () => {
      if (!active) return
      const channels = await snapshot()
      if (channels.length === lastCount) return
      publish(channels)
    }),
    emitSessionStart: () => {
      active = true
      return enqueue(async () => publish(await snapshot()))
    },
    emitShutdown: () => {
      active = false
      return enqueue(() => publish([]))
    },
  }
}
