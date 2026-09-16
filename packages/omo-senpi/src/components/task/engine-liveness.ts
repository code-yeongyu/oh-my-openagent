import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { log } from "@oh-my-opencode/utils"
import type { StateDirConfig, TaskRecord, TaskRecordStore } from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"
import { createOwnedMemberLivenessNotifier } from "./owned-member-liveness"
import { createTeamMemberLivenessNotifier, type TeamMemberLivenessNotifier } from "./member-liveness"
import type { TaskRuntimeContext } from "./runtime-context"

export type EngineLivenessDeps = {
  readonly pi: SenpiExtensionAPI
  readonly coordinator?: IdleInjectionCoordinator
  readonly runtime: TaskRuntimeContext
  readonly store: TaskRecordStore
  readonly stateDir: StateDirConfig
  readonly settings: OmoTaskSettings
}

export type EngineLiveness = {
  readonly memberLiveness: TeamMemberLivenessNotifier
  readonly notifyOwnedMemberLiveness: (record: TaskRecord) => Promise<void>
}

/**
 * Team-member liveness delivery for the engine: the notifier itself plus the ownership gate that
 * decides whether THIS session may report a member's death. The delivery marker is read from and
 * written to the record's `liveness_notified_epoch` so a redelivery after a reload is idempotent,
 * and every marker failure is logged rather than thrown - a liveness notice must never break the
 * store write that triggered it.
 */
export function createEngineLiveness(deps: EngineLivenessDeps): EngineLiveness {
  const memberLiveness = createTeamMemberLivenessNotifier({
    pi: deps.pi,
    ...(deps.coordinator === undefined ? {} : { coordinator: deps.coordinator }),
    isStreaming: () => deps.runtime.parentState().kind === "streaming",
    wasDelivered: (record) => {
      try {
        const fresh = deps.store.load(record.task_id) ?? record
        return (fresh.notification.liveness_notified_epoch ?? -1) >= record.notification.run_epoch
      } catch (error) {
        log("omo-senpi team liveness marker read failed", {
          taskId: record.task_id,
          error: error instanceof Error ? error.message : String(error),
        })
        return false
      }
    },
    markDelivered: (record) => {
      try {
        const capturedEpoch = record.notification.run_epoch
        deps.store.mutate(record.task_id, (fresh) => {
          if (fresh.status !== record.status || fresh.notification.run_epoch !== capturedEpoch) return fresh
          if ((fresh.notification.liveness_notified_epoch ?? -1) >= capturedEpoch) return fresh
          return {
            ...fresh,
            notification: { ...fresh.notification, liveness_notified_epoch: capturedEpoch },
          }
        })
      } catch (error) {
        log("omo-senpi team liveness marker write failed", {
          taskId: record.task_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    onError: (error) => {
      log("omo-senpi team liveness delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })
  return {
    memberLiveness,
    notifyOwnedMemberLiveness: createOwnedMemberLivenessNotifier({
      stateDir: deps.stateDir,
      settings: deps.settings,
      runtime: deps.runtime,
      notifier: memberLiveness,
      onError: (error, record) => {
        log("omo-senpi team liveness ownership check failed", {
          taskId: record.task_id,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    }),
  }
}
