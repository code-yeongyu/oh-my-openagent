import { loadRuntimeState, transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import type { RuntimeState } from "@oh-my-opencode/team-core/types"

import { TEAM_LEAD_SENTINEL } from "./normalize"
import type { TeamCoreConfig } from "./runtime-config"
import { findLatestShutdownRequestIndex, findRuntimeMember, isUnresolvedRequest } from "./shutdown-helpers"

export type SenpiShutdownErrorCode = "unknown_member" | "no_pending_request"

/**
 * Raised by the shutdown protocol for the two lead-driven failure modes: a request/approval/rejection
 * that names a member the team never spawned, and an approve/reject issued when the member has no
 * outstanding shutdown request. Carries the team run and member in play for diagnostics.
 */
export class SenpiShutdownError extends Error {
  readonly code: SenpiShutdownErrorCode
  readonly teamRunId: string
  readonly memberName: string

  constructor(message: string, code: SenpiShutdownErrorCode, teamRunId: string, memberName: string) {
    super(message)
    this.name = "SenpiShutdownError"
    this.code = code
    this.teamRunId = teamRunId
    this.memberName = memberName
  }
}

export type ShutdownMessageKind = "shutdown_request" | "shutdown_approved" | "shutdown_rejected"

// A single shutdown-protocol message the lead emits toward a member. The transport is injected so
// the shutdown protocol stays decoupled from the messaging layer (todo 22) and testable in isolation.
export type ShutdownOutboundMessage = {
  readonly to: string
  readonly kind: ShutdownMessageKind
  readonly body: string
}

export type ShutdownMessenger = (message: ShutdownOutboundMessage) => Promise<void>

export type RequestShutdownDeps = {
  readonly config: TeamCoreConfig
  readonly sendMessage: ShutdownMessenger
  readonly now?: () => number
}

export type ApproveShutdownDeps = RequestShutdownDeps & {
  readonly cancelMemberTask: (memberName: string) => Promise<void>
}

export type RejectShutdownDeps = RequestShutdownDeps

function requireMember(state: RuntimeState, teamRunId: string, memberName: string): void {
  if (findRuntimeMember(state, memberName) === undefined) {
    throw new SenpiShutdownError(`unknown team member '${memberName}'`, "unknown_member", teamRunId, memberName)
  }
}

function requirePendingRequestIndex(state: RuntimeState, teamRunId: string, memberName: string): number {
  const index = findLatestShutdownRequestIndex(state, memberName)
  if (index < 0 || !isUnresolvedRequest(state.shutdownRequests[index])) {
    throw new SenpiShutdownError(`no pending shutdown request for '${memberName}'`, "no_pending_request", teamRunId, memberName)
  }
  return index
}

/**
 * Lead requests a member's shutdown: sends a `shutdown_request` message to the member, then records
 * an unresolved shutdown request keyed to the lead sentinel. Idempotent while a request is pending,
 * and a resolved (approved/rejected) prior request never blocks a fresh one.
 */
export async function requestShutdown(
  teamRunId: string,
  memberName: string,
  deps: RequestShutdownDeps,
): Promise<RuntimeState> {
  const state = await loadRuntimeState(teamRunId, deps.config)
  requireMember(state, teamRunId, memberName)

  const existingIndex = findLatestShutdownRequestIndex(state, memberName)
  if (isUnresolvedRequest(state.shutdownRequests[existingIndex])) return state

  await deps.sendMessage({ to: memberName, kind: "shutdown_request", body: "" })

  const requestedAt = (deps.now ?? Date.now)()
  return transitionRuntimeState(
    teamRunId,
    (current) => {
      const currentIndex = findLatestShutdownRequestIndex(current, memberName)
      if (isUnresolvedRequest(current.shutdownRequests[currentIndex])) return current
      return {
        ...current,
        shutdownRequests: [
          ...current.shutdownRequests,
          { memberId: memberName, requesterName: TEAM_LEAD_SENTINEL, requestedAt },
        ],
      }
    },
    deps.config,
  )
}

/**
 * Lead approves a pending shutdown: marks the member `shutdown_approved` (unless it already finished
 * or errored, whose terminal status is preserved), stamps the request approved, cancels the member's
 * background task, then notifies the member. Idempotent once the request is already approved.
 */
export async function approveShutdown(
  teamRunId: string,
  memberName: string,
  deps: ApproveShutdownDeps,
): Promise<RuntimeState> {
  const state = await loadRuntimeState(teamRunId, deps.config)
  requireMember(state, teamRunId, memberName)
  const requestIndex = requirePendingRequestIndex(state, teamRunId, memberName)
  if (state.shutdownRequests[requestIndex]?.approvedAt !== undefined) return state

  const approvedAt = (deps.now ?? Date.now)()
  const updated = await transitionRuntimeState(
    teamRunId,
    (current) => {
      const currentIndex = findLatestShutdownRequestIndex(current, memberName)
      return {
        ...current,
        members: current.members.map((member) => {
          if (member.name !== memberName || member.status === "completed" || member.status === "errored") return member
          return { ...member, status: "shutdown_approved" }
        }),
        shutdownRequests: current.shutdownRequests.map((request, index) =>
          index === currentIndex ? { ...request, approvedAt } : request,
        ),
      }
    },
    deps.config,
  )

  await deps.cancelMemberTask(memberName)
  await deps.sendMessage({ to: memberName, kind: "shutdown_approved", body: memberName })
  return updated
}

/**
 * Lead rejects a pending shutdown: notifies the member with the reason (keep working), then records
 * the rejection on the request while leaving the member's live status untouched. Idempotent when the
 * latest request already carries the same rejection reason.
 */
export async function rejectShutdown(
  teamRunId: string,
  memberName: string,
  reason: string,
  deps: RejectShutdownDeps,
): Promise<RuntimeState> {
  const state = await loadRuntimeState(teamRunId, deps.config)
  requireMember(state, teamRunId, memberName)
  const requestIndex = requirePendingRequestIndex(state, teamRunId, memberName)

  const existing = state.shutdownRequests[requestIndex]
  if (existing?.rejectedAt !== undefined && existing.rejectedReason === reason) return state

  await deps.sendMessage({ to: memberName, kind: "shutdown_rejected", body: reason })

  const rejectedAt = (deps.now ?? Date.now)()
  return transitionRuntimeState(
    teamRunId,
    (current) => {
      const currentIndex = findLatestShutdownRequestIndex(current, memberName)
      return {
        ...current,
        shutdownRequests: current.shutdownRequests.map((request, index) =>
          index === currentIndex ? { ...request, rejectedAt, rejectedReason: reason } : request,
        ),
      }
    },
    deps.config,
  )
}
