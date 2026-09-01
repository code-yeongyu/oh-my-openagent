import { SenpiShutdownError, TEAM_LEAD_SENTINEL } from "../../team"
import { isMissingStateError } from "../team/classify-error"
import type { TeamToolsService } from "../team/types"
import { toolResult } from "./tool-result"
import { invalidArguments } from "./send-results"
import type { StructuredMessageInput, TaskSendInput } from "./send-schema"
import type { SendResultDetails, SendToolResult } from "./types"

type ShutdownFailureDetails = Extract<SendResultDetails, { readonly kind: "shutdown_failed" }>
type ShutdownFailureContext = Pick<ShutdownFailureDetails, "operation" | "team_run_id" | "member">

export type DefaultTeamRunIdResolution =
  | { readonly kind: "resolved"; readonly teamRunId: string }
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous"; readonly reason: string }

export type TaskSendTeamRouting = {
  readonly service: TeamToolsService
  readonly from: string
  readonly teamRunId?: string
  readonly resolveDefaultTeamRunId?: () => Promise<DefaultTeamRunIdResolution>
}

export type SendTeamRunIdResolution =
  | { readonly kind: "resolved"; readonly teamRunId: string }
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly reason: string }

// Explicit ids (bound routing first, then the param) always win. Without one, the wiring's default
// resolver (single-owned-team defaulting) is consulted; without a resolver the historical
// team_run_id-required error is preserved so un-wired adapters behave exactly as before.
export async function resolveSendTeamRunId(params: TaskSendInput, teamRouting: TaskSendTeamRouting): Promise<SendTeamRunIdResolution> {
  const explicit = teamRouting.teamRunId ?? params.team_run_id
  if (explicit !== undefined) return { kind: "resolved", teamRunId: explicit }
  if (teamRouting.resolveDefaultTeamRunId === undefined) {
    return { kind: "error", reason: "team_run_id is required to message a team member" }
  }
  const resolved = await teamRouting.resolveDefaultTeamRunId()
  if (resolved.kind === "resolved") return { kind: "resolved", teamRunId: resolved.teamRunId }
  if (resolved.kind === "none") return { kind: "none" }
  return { kind: "error", reason: resolved.reason }
}

export async function routeStructuredMessage(
  to: string,
  message: StructuredMessageInput,
  params: TaskSendInput,
  teamRouting: TaskSendTeamRouting | undefined,
): Promise<SendToolResult> {
  if (teamRouting === undefined) return invalidArguments("not in a team")
  if (teamRouting.from !== TEAM_LEAD_SENTINEL) return invalidArguments("shutdown is lead-only")

  const resolution = await resolveSendTeamRunId(params, teamRouting)
  if (resolution.kind === "none") return invalidArguments("not in a team")
  if (resolution.kind === "error") return invalidArguments(resolution.reason)
  const runId = resolution.teamRunId

  if (message.type === "shutdown_request") {
    try {
      await teamRouting.service.requestShutdown(runId, to)
    } catch (error) {
      if (!(error instanceof SenpiShutdownError) && !isMissingStateError(error)) throw error
      return shutdownFailure(error, { operation: "request", team_run_id: runId, member: to })
    }
    return toolResult(`Shutdown requested for ${to} (team ${runId}).`, { kind: "shutdown_requested", team_run_id: runId, member: to })
  }

  if (message.approve === true) {
    try {
      await teamRouting.service.approveShutdown(runId, to)
    } catch (error) {
      if (!(error instanceof SenpiShutdownError) && !isMissingStateError(error)) throw error
      return shutdownFailure(error, { operation: "approve", team_run_id: runId, member: to })
    }
    return toolResult(`Shutdown approved for ${to} (team ${runId}).`, {
      kind: "shutdown_responded",
      team_run_id: runId,
      member: to,
      approved: true,
    })
  }

  const reason = message.reason
  if (reason === undefined || reason.trim().length === 0) {
    return invalidArguments("reason is required when rejecting a shutdown")
  }
  try {
    await teamRouting.service.rejectShutdown(runId, to, reason)
  } catch (error) {
    if (!(error instanceof SenpiShutdownError) && !isMissingStateError(error)) throw error
    return shutdownFailure(error, { operation: "reject", team_run_id: runId, member: to })
  }
  return toolResult(`Shutdown rejected for ${to} (team ${runId}).`, {
    kind: "shutdown_responded",
    team_run_id: runId,
    member: to,
    approved: false,
  })
}

function shutdownFailure(error: unknown, context: ShutdownFailureContext): SendToolResult {
  let code: ShutdownFailureDetails["code"]
  if (error instanceof SenpiShutdownError) code = error.code
  else if (isMissingStateError(error)) code = "team_state_missing"
  else throw error
  const reason = shutdownFailureReason(code)
  return toolResult(`Shutdown ${context.operation} failed for ${context.member}: ${reason}`, {
    kind: "shutdown_failed",
    ...context,
    code,
    reason,
  })
}

function shutdownFailureReason(code: ShutdownFailureDetails["code"]): string {
  switch (code) {
    case "team_state_missing":
      return "Team state is unavailable."
    case "unknown_member":
      return "Team member is unavailable."
    case "no_pending_request":
      return "No pending shutdown request exists."
    default: {
      const exhaustive: never = code
      throw new Error(`Unhandled shutdown failure code: ${exhaustive}`)
    }
  }
}
