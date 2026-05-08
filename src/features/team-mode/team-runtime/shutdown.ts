import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { sendMessage } from "../team-mailbox/send"
import { loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import {
  createSendContext,
  createShutdownMessage,
  findLatestShutdownRequestIndex,
  getLeadMemberName,
  getRuntimeMember,
} from "./shutdown-helpers"
export { deleteTeam } from "./delete-team"

export type ShutdownActor = {
  memberName: string
  role: "lead" | "member"
}

function assertShutdownRequester(actor: ShutdownActor): void {
  if (actor.role !== "lead") {
    throw new Error("team_shutdown_request is lead-only")
  }
}

function assertShutdownResponder(actor: ShutdownActor, targetMemberName: string): void {
  if (actor.role === "lead" || actor.memberName === targetMemberName) {
    return
  }

  throw new Error("caller must be target member or team lead")
}

export async function requestShutdownOfMember(
  teamRunId: string,
  targetMemberName: string,
  actor: ShutdownActor,
  config: TeamModeConfig,
): Promise<void> {
  const runtimeState = await loadRuntimeState(teamRunId, config)
  assertShutdownRequester(actor)
  getRuntimeMember(runtimeState, targetMemberName)
  getRuntimeMember(runtimeState, actor.memberName)

  const existingRequestIndex = findLatestShutdownRequestIndex(runtimeState, targetMemberName, actor.memberName)
  const existingRequest = existingRequestIndex >= 0
    ? runtimeState.shutdownRequests[existingRequestIndex]
    : undefined
  if (existingRequest && existingRequest.approvedAt === undefined && existingRequest.rejectedAt === undefined) {
    return
  }

  await sendMessage(
    createShutdownMessage(actor.memberName, targetMemberName, "shutdown_request", ""),
    teamRunId,
    config,
    createSendContext(runtimeState, actor.memberName),
  )

  await transitionRuntimeState(teamRunId, (currentRuntimeState) => {
    assertShutdownRequester(actor)
    getRuntimeMember(currentRuntimeState, targetMemberName)
    getRuntimeMember(currentRuntimeState, actor.memberName)

    const duplicateRequestIndex = findLatestShutdownRequestIndex(currentRuntimeState, targetMemberName, actor.memberName)
    const duplicateRequest = duplicateRequestIndex >= 0
      ? currentRuntimeState.shutdownRequests[duplicateRequestIndex]
      : undefined
    if (duplicateRequest && duplicateRequest.approvedAt === undefined && duplicateRequest.rejectedAt === undefined) {
      return currentRuntimeState
    }

    return {
      ...currentRuntimeState,
      shutdownRequests: [
        ...currentRuntimeState.shutdownRequests,
        { memberId: targetMemberName, requesterName: actor.memberName, requestedAt: Date.now() },
      ],
    }
  }, config)
}

export async function approveShutdown(
  teamRunId: string,
  memberName: string,
  actor: ShutdownActor,
  config: TeamModeConfig,
): Promise<void> {
  const runtimeState = await loadRuntimeState(teamRunId, config)
  assertShutdownResponder(actor, memberName)
  getRuntimeMember(runtimeState, actor.memberName)
  const shutdownRequestIndex = findLatestShutdownRequestIndex(runtimeState, memberName)
  if (shutdownRequestIndex < 0) {
    throw new Error(`shutdown request missing for '${memberName}'`)
  }

  const existingRequest = runtimeState.shutdownRequests[shutdownRequestIndex]
  if (existingRequest?.approvedAt !== undefined) {
    return
  }

  const updatedRuntimeState = await transitionRuntimeState(teamRunId, (currentRuntimeState) => {
    assertShutdownResponder(actor, memberName)
    getRuntimeMember(currentRuntimeState, actor.memberName)

    const currentRequestIndex = findLatestShutdownRequestIndex(currentRuntimeState, memberName)
    if (currentRequestIndex < 0) {
      throw new Error(`shutdown request missing for '${memberName}'`)
    }

    const currentRequest = currentRuntimeState.shutdownRequests[currentRequestIndex]
    if (!currentRequest || currentRequest.approvedAt !== undefined) {
      return currentRuntimeState
    }

    return {
      ...currentRuntimeState,
      members: currentRuntimeState.members.map((member) => {
        if (member.name !== memberName || member.status === "completed" || member.status === "errored") {
          return member
        }

        return { ...member, status: "shutdown_approved" }
      }),
      shutdownRequests: currentRuntimeState.shutdownRequests.map((shutdownRequest, index) => index === currentRequestIndex
        ? { ...shutdownRequest, approvedAt: Date.now() }
        : shutdownRequest),
    }
  }, config)

  await sendMessage(
    createShutdownMessage(actor.memberName, getLeadMemberName(updatedRuntimeState), "shutdown_approved", memberName),
    teamRunId,
    config,
    createSendContext(updatedRuntimeState, actor.memberName),
  )
}

export async function rejectShutdown(
  teamRunId: string,
  memberName: string,
  reason: string,
  actor: ShutdownActor,
  config: TeamModeConfig,
): Promise<void> {
  const runtimeState = await loadRuntimeState(teamRunId, config)
  assertShutdownResponder(actor, memberName)
  getRuntimeMember(runtimeState, actor.memberName)
  const shutdownRequestIndex = findLatestShutdownRequestIndex(runtimeState, memberName)
  if (shutdownRequestIndex < 0) {
    throw new Error(`shutdown request missing for '${memberName}'`)
  }

  const shutdownRequest = runtimeState.shutdownRequests[shutdownRequestIndex]
  if (shutdownRequest.rejectedAt !== undefined && shutdownRequest.rejectedReason === reason) {
    return
  }

  await sendMessage(
    createShutdownMessage(actor.memberName, shutdownRequest.requesterName, "shutdown_rejected", reason),
    teamRunId,
    config,
    createSendContext(runtimeState, actor.memberName),
  )

  await transitionRuntimeState(teamRunId, (currentRuntimeState) => {
    assertShutdownResponder(actor, memberName)
    getRuntimeMember(currentRuntimeState, actor.memberName)

    const currentRequestIndex = findLatestShutdownRequestIndex(currentRuntimeState, memberName)
    if (currentRequestIndex < 0) {
      throw new Error(`shutdown request missing for '${memberName}'`)
    }

    return {
      ...currentRuntimeState,
      shutdownRequests: currentRuntimeState.shutdownRequests.map((currentRequest, index) => index === currentRequestIndex
        ? { ...currentRequest, rejectedAt: Date.now(), rejectedReason: reason }
        : currentRequest),
    }
  }, config)
}
