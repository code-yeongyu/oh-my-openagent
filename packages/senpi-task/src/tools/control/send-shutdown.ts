import { TEAM_LEAD_SENTINEL } from "../../team"
import type { TeamToolsService } from "../team/types"
import { toolResult } from "./tool-result"
import { invalidArguments } from "./send-results"
import type { StructuredMessageInput, TaskSendInput } from "./send-schema"
import type { SendToolResult } from "./types"

export type TaskSendTeamRouting = {
  readonly service: TeamToolsService
  readonly from: string
  readonly teamRunId?: string
}

export function resolveTeamRunId(params: TaskSendInput, teamRouting: TaskSendTeamRouting): string | undefined {
  return teamRouting.teamRunId ?? params.team_run_id
}

export function missingTeamRunId(): SendToolResult {
  return invalidArguments("team_run_id is required to message a team member")
}

export async function routeStructuredMessage(
  to: string,
  message: StructuredMessageInput,
  params: TaskSendInput,
  teamRouting: TaskSendTeamRouting | undefined,
): Promise<SendToolResult> {
  if (teamRouting === undefined) return invalidArguments("not in a team")
  if (teamRouting.from !== TEAM_LEAD_SENTINEL) return invalidArguments("shutdown is lead-only")

  const runId = resolveTeamRunId(params, teamRouting)
  if (runId === undefined) return missingTeamRunId()

  if (message.type === "shutdown_request") {
    await teamRouting.service.requestShutdown(runId, to)
    return toolResult(`Shutdown requested for ${to}.`, { kind: "shutdown_requested", team_run_id: runId, member: to })
  }

  if (message.approve === true) {
    await teamRouting.service.approveShutdown(runId, to)
    return toolResult(`Shutdown approved for ${to}.`, {
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
  await teamRouting.service.rejectShutdown(runId, to, reason)
  return toolResult(`Shutdown rejected for ${to}.`, {
    kind: "shutdown_responded",
    team_run_id: runId,
    member: to,
    approved: false,
  })
}
