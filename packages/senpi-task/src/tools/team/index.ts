import type { ToolDefinition } from "@code-yeongyu/senpi"

import { createTeamCreateTool, createTeamDeleteTool } from "./lifecycle"
import { createTeamTaskCreateTool, createTeamTaskGetTool, createTeamTaskListTool, createTeamTaskUpdateTool } from "./tasks"
import type { TeamToolDeps } from "./types"

export type { ActiveTeamSummary, CreateTeamTaskServiceInput, CreateTeamToolInput, TeamToolDeps, TeamToolsService, TeamTaskStatus, UpdateTeamTaskServiceInput } from "./types"
export { classifyMailboxError, isMissingStateError } from "./classify-error"
export type { MailboxErrorKind } from "./classify-error"
export {
  TeamCreateParams,
  TeamDeleteParams,
  createTeamCreateTool,
  createTeamDeleteTool,
  runTeamCreate,
  runTeamDelete,
} from "./lifecycle"
export type { TeamCreateDetails, TeamCreateInput, TeamCreateMemberView, TeamDeleteDetails, TeamDeleteInput } from "./lifecycle"
export { runTeamSend } from "./messaging"
export type {
  LeadDeliveryView,
  MemberDeliveryOutcome,
  TeamSendDetails,
  TeamSendInput,
  TeamSendMemberView,
} from "./messaging"
export {
  TeamTaskCreateParams,
  TeamTaskGetParams,
  TeamTaskListParams,
  TeamTaskUpdateParams,
  createTeamTaskCreateTool,
  createTeamTaskGetTool,
  createTeamTaskListTool,
  createTeamTaskUpdateTool,
  runTeamTaskCreate,
  runTeamTaskGet,
  runTeamTaskList,
  runTeamTaskUpdate,
} from "./tasks"
export type {
  TeamTaskCreateDetails,
  TeamTaskCreateInput,
  TeamTaskGetDetails,
  TeamTaskGetInput,
  TeamTaskListDetails,
  TeamTaskListInput,
  TeamTaskUpdateDetails,
  TeamTaskUpdateInput,
} from "./tasks"
export {
  runTeamApproveShutdown,
  runTeamRejectShutdown,
  runTeamShutdownRequest,
} from "./shutdown"
export type {
  ShutdownErrorView,
  TeamApproveShutdownDetails,
  TeamApproveShutdownInput,
  TeamRejectShutdownDetails,
  TeamRejectShutdownInput,
  TeamShutdownRequestDetails,
  TeamShutdownRequestInput,
} from "./shutdown"

export function buildLeadTeamTools(deps: TeamToolDeps): ToolDefinition[] {
  return [
    createTeamCreateTool(deps),
    createTeamDeleteTool(deps),
    createTeamTaskCreateTool(deps),
    createTeamTaskGetTool(deps),
    createTeamTaskListTool(deps),
    createTeamTaskUpdateTool(deps),
  ]
}
