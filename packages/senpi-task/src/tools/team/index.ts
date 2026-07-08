import type { ToolDefinition } from "@code-yeongyu/senpi"

import { createTeamCreateTool, createTeamDeleteTool } from "./lifecycle"
import { createTeamSendMessageTool } from "./messaging"
import { createTeamListTool, createTeamStatusTool } from "./status"
import { createTeamTaskCreateTool, createTeamTaskGetTool, createTeamTaskListTool, createTeamTaskUpdateTool } from "./tasks"
import { createTeamApproveShutdownTool, createTeamRejectShutdownTool, createTeamShutdownRequestTool } from "./shutdown"
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
export {
  MemberSendMessageParams,
  TeamSendMessageParams,
  createMemberScopedSendMessageTool,
  createTeamSendMessageTool,
  runTeamSend,
} from "./messaging"
export type {
  LeadDeliveryView,
  MemberDeliveryOutcome,
  MemberScopedSendDeps,
  MemberSendMessageInput,
  TeamSendDetails,
  TeamSendInput,
  TeamSendMemberView,
  TeamSendMessageInput,
} from "./messaging"
export { TeamListParams, TeamStatusParams, createTeamListTool, createTeamStatusTool, runTeamList, runTeamStatus } from "./status"
export type { TeamListDetails, TeamListRow, TeamStatusDetails, TeamStatusInput, TeamStatusMemberView } from "./status"
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
  TeamApproveShutdownParams,
  TeamRejectShutdownParams,
  TeamShutdownRequestParams,
  createTeamApproveShutdownTool,
  createTeamRejectShutdownTool,
  createTeamShutdownRequestTool,
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

/**
 * The 12 lead-only team tools, in canonical order. The omo-senpi component registers this set on the
 * lead (current) session; child/member sessions never receive them (the shared-tool filter strips the
 * whole `team_*` family, and only the pre-scoped member `team_send_message` is re-added). Returned as
 * base `ToolDefinition`s so the array is a single homogeneous type for registration and filtering.
 */
export function buildLeadTeamTools(deps: TeamToolDeps): ToolDefinition[] {
  return [
    createTeamCreateTool(deps),
    createTeamDeleteTool(deps),
    createTeamSendMessageTool(deps),
    createTeamStatusTool(deps),
    createTeamListTool(deps),
    createTeamTaskCreateTool(deps),
    createTeamTaskListTool(deps),
    createTeamTaskUpdateTool(deps),
    createTeamTaskGetTool(deps),
    createTeamShutdownRequestTool(deps),
    createTeamApproveShutdownTool(deps),
    createTeamRejectShutdownTool(deps),
  ]
}
