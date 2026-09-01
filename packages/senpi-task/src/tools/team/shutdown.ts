import type { AgentToolResult } from "@code-yeongyu/senpi"

import { SenpiShutdownError } from "../../team"
import { toolResult } from "../control"
import type { TeamToolsService } from "./types"

// Shutdown has no standalone tool registration: the model-facing surface is the structured-message
// union on task_send. These input types describe the runner calls only; the dead TypeBox param
// schemas that implied standalone team_shutdown_* tools were removed so no future registrar wires
// a second, inconsistent shutdown UI.
export type TeamShutdownRequestInput = {
  readonly team_run_id: string
  readonly member: string
}

export type TeamApproveShutdownInput = {
  readonly team_run_id: string
  readonly member: string
}

export type TeamRejectShutdownInput = {
  readonly team_run_id: string
  readonly member: string
  readonly reason: string
}

export type ShutdownErrorView =
  | { readonly kind: "unknown_member"; readonly member: string; readonly reason: string }
  | { readonly kind: "no_pending_request"; readonly member: string; readonly reason: string }

export type TeamShutdownRequestDetails = { readonly kind: "requested"; readonly team_run_id: string; readonly member: string } | ShutdownErrorView
export type TeamApproveShutdownDetails = { readonly kind: "approved"; readonly team_run_id: string; readonly member: string } | ShutdownErrorView
export type TeamRejectShutdownDetails = { readonly kind: "rejected"; readonly team_run_id: string; readonly member: string; readonly reason: string } | ShutdownErrorView

// Maps the two lead-driven shutdown failures onto the shared error view; every other throw propagates.
function shutdownErrorView(error: unknown): ShutdownErrorView {
  if (error instanceof SenpiShutdownError) {
    return { kind: error.code, member: error.memberName, reason: error.message }
  }
  throw error
}

export async function runTeamShutdownRequest(service: TeamToolsService, params: TeamShutdownRequestInput): Promise<AgentToolResult<TeamShutdownRequestDetails>> {
  try {
    await service.requestShutdown(params.team_run_id, params.member)
    return toolResult(`Requested shutdown for '${params.member}' (team ${params.team_run_id}).`, { kind: "requested", team_run_id: params.team_run_id, member: params.member })
  } catch (error) {
    const view = shutdownErrorView(error)
    return toolResult(view.reason, view)
  }
}

export async function runTeamApproveShutdown(service: TeamToolsService, params: TeamApproveShutdownInput): Promise<AgentToolResult<TeamApproveShutdownDetails>> {
  try {
    await service.approveShutdown(params.team_run_id, params.member)
    return toolResult(`Approved shutdown for '${params.member}' (team ${params.team_run_id}).`, { kind: "approved", team_run_id: params.team_run_id, member: params.member })
  } catch (error) {
    const view = shutdownErrorView(error)
    return toolResult(view.reason, view)
  }
}

export async function runTeamRejectShutdown(service: TeamToolsService, params: TeamRejectShutdownInput): Promise<AgentToolResult<TeamRejectShutdownDetails>> {
  try {
    await service.rejectShutdown(params.team_run_id, params.member, params.reason)
    return toolResult(`Rejected shutdown for '${params.member}' (team ${params.team_run_id}): ${params.reason.replace(/\s+/g, " ").trim().slice(0, 160)}`, { kind: "rejected", team_run_id: params.team_run_id, member: params.member, reason: params.reason })
  } catch (error) {
    const view = shutdownErrorView(error)
    return toolResult(view.reason, view)
  }
}
