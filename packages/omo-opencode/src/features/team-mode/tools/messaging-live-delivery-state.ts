import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import { transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store"
import type { RuntimeState } from "@oh-my-opencode/team-core/types"
import { releaseReservationsForRecipients } from "./messaging-live-delivery-reservation"
import type { TeamSendMessageToolDeps } from "./messaging-runtime"

export async function markLiveDeliveryPending(
  teamRunId: string,
  recipientName: string,
  messageId: string,
  config: TeamModeConfig,
): Promise<void> {
  await transitionRuntimeState(teamRunId, (currentRuntimeState) => ({
    ...currentRuntimeState,
    members: currentRuntimeState.members.map((member) => (
      member.name === recipientName
        ? {
          ...member,
          pendingInjectedMessageIds: Array.from(new Set([...member.pendingInjectedMessageIds, messageId])),
        }
        : member
    )),
  }), config)
}

export async function loadRuntimeStateForLiveDelivery(
  teamRunId: string,
  deliveredTo: readonly string[],
  messageId: string,
  config: TeamModeConfig,
  deps: TeamSendMessageToolDeps,
): Promise<RuntimeState | undefined> {
  try {
    return await deps.loadRuntimeState(teamRunId, config)
  } catch (error) {
    await releaseReservationsForRecipients(teamRunId, deliveredTo, messageId, config)
    log("[team-mailbox] live delivery unavailable after pre-reserve, released recipients to inbox", {
      teamRunId,
      messageId,
      deliveredTo,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
