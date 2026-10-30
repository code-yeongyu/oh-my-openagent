import type { ToolDefinition } from "@code-yeongyu/senpi"

import { createTeamCreateTool, createTeamDeleteTool } from "./lifecycle"
import { createTeamTaskCreateTool, createTeamTaskGetTool, createTeamTaskListTool, createTeamTaskUpdateTool } from "./tasks"
import type { LeadTeamToolDeps } from "./types"

export type { ActiveTeamSummary, CreateTeamTaskServiceInput, CreateTeamToolInput, LeadTeamToolDeps, TeamToolDeps, TeamToolsService, TeamTaskStatus, UpdateTeamTaskServiceInput } from "./types"
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

// Each factory is generically typed so its renderCall/renderResult keep the tool's own arg and
// details types; that makes the definitions invariant against the bare ToolDefinition element type,
// so the family is published as a union (registration spreads each one, as the task tools do).
export type LeadTeamTool =
  | ReturnType<typeof createTeamCreateTool>
  | ReturnType<typeof createTeamDeleteTool>
  | ReturnType<typeof createTeamTaskCreateTool>
  | ReturnType<typeof createTeamTaskGetTool>
  | ReturnType<typeof createTeamTaskListTool>
  | ReturnType<typeof createTeamTaskUpdateTool>

export function buildLeadTeamTools(deps: LeadTeamToolDeps): LeadTeamTool[] {
  return [
    createTeamCreateTool(deps),
    createTeamDeleteTool(deps),
    createTeamTaskCreateTool(deps),
    createTeamTaskGetTool(deps),
    createTeamTaskListTool(deps),
    createTeamTaskUpdateTool(deps),
  ]
}
