import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { isOwnedTeamMemberTask, type StateDirConfig, type TaskRecord } from "@oh-my-opencode/senpi-task"

import type { TaskRuntimeContext } from "./runtime-context"
import type { TeamMemberLivenessNotifier } from "./member-liveness"

export type OwnedMemberLivenessDeps = {
  readonly stateDir: StateDirConfig
  readonly settings: OmoTaskSettings
  readonly runtime: TaskRuntimeContext
  readonly notifier: TeamMemberLivenessNotifier
  readonly onError: (error: unknown, record: TaskRecord) => void
}

export function createOwnedMemberLivenessNotifier(
  deps: OwnedMemberLivenessDeps,
): (record: TaskRecord) => Promise<void> {
  return async (record) => {
    try {
      const sessionId = deps.runtime.sessionId()
      const owned = await isOwnedTeamMemberTask(record, sessionId, {
        stateDir: deps.stateDir,
        taskSettings: deps.settings,
      })
      if (owned && deps.runtime.sessionId() === sessionId) deps.notifier.notifyTerminal(record)
    } catch (error) {
      deps.onError(error, record)
    }
  }
}
