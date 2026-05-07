import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { z } from "zod"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { CategoriesConfig, AgentOverrides } from "../../../config/schema"
import { mergeCategories } from "../../../shared/merge-categories"
import type { OpencodeClient } from "../../../tools/delegate-task/types"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { resolveCallerTeamLead } from "../resolve-caller-team-lead"
import { loadTeamSpec, normalizeTeamSpecInput } from "../team-registry/loader"
import { validateSpec } from "../team-registry/validator"
import { createTeamRun } from "../team-runtime/create"
import { approveShutdown, deleteTeam, rejectShutdown, requestShutdownOfMember } from "../team-runtime/shutdown"
import { listActiveTeams, loadRuntimeState } from "../team-state-store/store"
import { TeamSpecSchema, type RuntimeState, type TeamSpec } from "../types"

const ACTIVE_RUNTIME_STATUSES = new Set<RuntimeState["status"]>(["creating", "active", "shutdown_requested"])
const TEAM_CREATE_USAGE = "team_create requires exactly one of teamName or inline_spec. Use team_create({ teamName: \"existing-team\" }) or team_create({ inline_spec: { name: \"team-name\", members: [{ name: \"worker\", category: \"quick\", prompt: \"Do the assigned work.\" }] } })."

const TeamCreateArgsSchema = z.object({
  teamName: z.string().min(1).optional(),
  inline_spec: z.unknown().optional(),
  leadSessionId: z.string().optional(),
}).superRefine((value, ctx) => {
  const optionCount = Number(value.teamName !== undefined) + Number(value.inline_spec !== undefined)
  if (optionCount !== 1) {
    ctx.addIssue({ code: "custom", message: "Provide exactly one of teamName or inline_spec." })
  }
})

const TeamDeleteArgsSchema = z.object({ teamRunId: z.string().min(1), force: z.boolean().optional() })
const TeamShutdownRequestArgsSchema = z.object({ teamRunId: z.string().min(1), targetMemberName: z.string().min(1) })
const TeamApproveShutdownArgsSchema = z.object({ teamRunId: z.string().min(1), memberName: z.string().min(1) })
const TeamRejectShutdownArgsSchema = z.object({
  teamRunId: z.string().min(1),
  memberName: z.string().min(1),
  reason: z.string().min(1),
})

type TeamLifecycleToolContext = ToolContext & {
  sessionID: string
  directory?: string
}

type TeamParticipant = { role: "lead" | "member"; memberName: string }

type TeamCreateArgs = z.infer<typeof TeamCreateArgsSchema>

function resolveDefaultInlineCategory(userCategories?: CategoriesConfig): string | undefined {
  const userCategoryName = Object.entries(userCategories ?? {}).find(([, categoryConfig]) => categoryConfig.disable !== true)?.[0]
  if (userCategoryName !== undefined) {
    return userCategoryName
  }

  return Object.keys(mergeCategories(userCategories))[0]
}

function getLeadMemberName(runtimeState: RuntimeState): string {
  const leadMember = runtimeState.members.find((member) => member.agentType === "leader")
  if (!leadMember) throw new Error(`team '${runtimeState.teamRunId}' is missing a lead member`)
  return leadMember.name
}

function sanitizeRuntimeState(runtimeState: RuntimeState): Omit<RuntimeState, "members"> & {
  members: Array<Omit<RuntimeState["members"][number], "lastInjectedTurnMarker" | "pendingInjectedMessageIds">>
} {
  return {
    ...runtimeState,
    members: runtimeState.members.map(({ lastInjectedTurnMarker: _turnMarker, pendingInjectedMessageIds: _pendingIds, ...member }) => member),
  }
}

function parseTeamCreateArgs(rawArgs: unknown): TeamCreateArgs {
  const result = TeamCreateArgsSchema.safeParse(rawArgs)
  if (!result.success) {
    throw new Error(TEAM_CREATE_USAGE)
  }

  return result.data
}

function formatZodIssuePath(path: PropertyKey[]): string {
  return path.length > 0 ? path.join(".") : "<root>"
}

function formatTeamSpecIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${formatZodIssuePath(issue.path)}: ${issue.message}`)
    .join("; ")
}

function parseInlineTeamSpec(
  rawSpec: unknown,
  options?: Parameters<typeof normalizeTeamSpecInput>[1],
): TeamSpec {
  let specObject: unknown = rawSpec
  if (typeof rawSpec === "string") {
    try {
      specObject = JSON.parse(rawSpec)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`inline_spec is a string but not valid JSON: ${message}`)
    }
  }

  const parsedSpecResult = TeamSpecSchema.safeParse(normalizeTeamSpecInput(specObject, options))
  if (!parsedSpecResult.success) {
    throw new Error(`Invalid inline_spec for team_create: ${formatTeamSpecIssues(parsedSpecResult.error)}. Provide an object with name and members array. Example: team_create({ inline_spec: { name: "project-analysis-team", members: [{ name: "structure-analyst", category: "quick", prompt: "Analyze project structure." }] } }).`)
  }

  const parsedSpec = parsedSpecResult.data
  validateSpec(parsedSpec)
  return parsedSpec
}

type TeamRuntimeStoreDeps = {
  listActiveTeams: typeof listActiveTeams
  loadRuntimeState: typeof loadRuntimeState
}

async function findParticipantRuntime(sessionID: string, config: TeamModeConfig, deps: TeamRuntimeStoreDeps): Promise<RuntimeState | undefined> {
  for (const activeTeam of await deps.listActiveTeams(config)) {
    const runtimeState = await deps.loadRuntimeState(activeTeam.teamRunId, config).catch(() => undefined)
    if (!runtimeState || !ACTIVE_RUNTIME_STATUSES.has(runtimeState.status)) continue
    if (runtimeState.leadSessionId === sessionID) return runtimeState
    if (runtimeState.members.some((member) => member.sessionId === sessionID)) return runtimeState
  }
}

type TeamShutdownToolDeps = TeamRuntimeStoreDeps & {
  deleteTeam: typeof deleteTeam
  requestShutdownOfMember: typeof requestShutdownOfMember
  approveShutdown: typeof approveShutdown
  rejectShutdown: typeof rejectShutdown
}

const defaultTeamShutdownToolDeps: TeamShutdownToolDeps = {
  listActiveTeams,
  loadRuntimeState,
  deleteTeam,
  requestShutdownOfMember,
  approveShutdown,
  rejectShutdown,
}

async function resolveParticipant(teamRunId: string, sessionID: string, config: TeamModeConfig, deps: TeamRuntimeStoreDeps): Promise<{ runtimeState: RuntimeState; participant?: TeamParticipant }> {
  const runtimeState = await deps.loadRuntimeState(teamRunId, config)
  if (runtimeState.leadSessionId === sessionID) {
    return { runtimeState, participant: { role: "lead", memberName: getLeadMemberName(runtimeState) } }
  }
  const member = runtimeState.members.find((candidate) => candidate.sessionId === sessionID)
  return member ? { runtimeState, participant: { role: "member", memberName: member.name } } : { runtimeState }
}

export type TeamCreateExecutorConfig = {
  userCategories?: CategoriesConfig
  sisyphusJuniorModel?: string
  agentOverrides?: AgentOverrides
}

type TeamCreateToolDeps = {
  createTeamRun: typeof createTeamRun
  loadTeamSpec: typeof loadTeamSpec
  listActiveTeams: typeof listActiveTeams
  loadRuntimeState: typeof loadRuntimeState
}

const defaultTeamCreateToolDeps: TeamCreateToolDeps = {
  createTeamRun,
  loadTeamSpec,
  listActiveTeams,
  loadRuntimeState,
}

export function createTeamCreateTool(
  config: TeamModeConfig,
  client: OpencodeClient,
  bgMgr: BackgroundManager,
  tmuxMgr?: TmuxSessionManager,
  executorConfig?: TeamCreateExecutorConfig,
  deps: TeamCreateToolDeps = defaultTeamCreateToolDeps,
): ToolDefinition {
  return tool({
    description: "Create a team run from a named or inline team spec.",
    args: {
      teamName: tool.schema.string().optional().describe("Named team spec to load. Provide exactly one of teamName or inline_spec."),
      inline_spec: tool.schema.unknown().optional().describe("Inline team spec object or JSON string. Provide exactly one of teamName or inline_spec."),
      leadSessionId: tool.schema.string().optional().describe("Optional non-empty session ID override. Usually omit this and let team_create use the current session."),
    },
    async execute(rawArgs, toolContext) {
      const args = parseTeamCreateArgs(rawArgs)
      const runtimeContext = toolContext as TeamLifecycleToolContext
      const leadSessionId = args.leadSessionId ?? runtimeContext.sessionID
      if (!leadSessionId) throw new Error("team_create requires leadSessionId or tool context sessionID")
      const projectRoot = typeof runtimeContext.directory === "string" ? runtimeContext.directory : process.cwd()
      const callerTeamLead = resolveCallerTeamLead(runtimeContext.agent)
      const defaultCategoryName = resolveDefaultInlineCategory(executorConfig?.userCategories)
      const spec = args.teamName
        ? await deps.loadTeamSpec(args.teamName, config, projectRoot, { callerTeamLead })
        : parseInlineTeamSpec(args.inline_spec, { callerTeamLead, defaultCategoryName })
      const participantRuntime = await findParticipantRuntime(runtimeContext.sessionID, config, deps)
      if (participantRuntime && (participantRuntime.teamName !== spec.name || participantRuntime.leadSessionId !== leadSessionId)) {
        throw new Error(`team_create denied: session is already a participant of team ${participantRuntime.teamRunId}`)
      }
      const runtimeState = await deps.createTeamRun(
        spec,
        leadSessionId,
        {
          client,
          manager: bgMgr,
          directory: projectRoot,
          userCategories: executorConfig?.userCategories,
          sisyphusJuniorModel: executorConfig?.sisyphusJuniorModel,
          agentOverrides: executorConfig?.agentOverrides,
        },
        config,
        bgMgr,
        tmuxMgr,
        {
          callerAgentTypeId: callerTeamLead.agentTypeId,
          parentMessageID: runtimeContext.messageID,
        },
      )
      return JSON.stringify({ teamRunId: runtimeState.teamRunId, runtimeState: sanitizeRuntimeState(runtimeState) })
    },
  })
}

export function createTeamDeleteTool(
  config: TeamModeConfig,
  client: OpencodeClient,
  backgroundManager: BackgroundManager,
  tmuxMgr?: TmuxSessionManager,
  deps: TeamShutdownToolDeps = defaultTeamShutdownToolDeps,
): ToolDefinition {
  void client

  return tool({
    description: "Delete a completed or shutdown-approved team run. Pass force=true to tear it down even while members are still active.",
    args: { teamRunId: tool.schema.string(), force: tool.schema.boolean().optional() },
    async execute(rawArgs, toolContext) {
      const args = TeamDeleteArgsSchema.parse(rawArgs)
      const runtimeContext = toolContext as TeamLifecycleToolContext
      const { runtimeState, participant } = await resolveParticipant(args.teamRunId, runtimeContext.sessionID, config, deps)
      const isOrphanedForceDelete = args.force === true && runtimeState.status === "orphaned"
      const isStuckDeletingForceDelete = args.force === true && runtimeState.status === "deleting"
      const isForceBypass = (isStuckDeletingForceDelete || isOrphanedForceDelete) && participant !== undefined
      if (!isForceBypass && participant?.role !== "lead") {
        throw new Error("team_delete is lead-only")
      }
      return JSON.stringify({ teamRunId: args.teamRunId, teamName: runtimeState.teamName, deleted: true, ...(await deps.deleteTeam(args.teamRunId, config, tmuxMgr, backgroundManager, { force: args.force })) })
    },
  })
}

export function createTeamShutdownRequestTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamShutdownToolDeps = defaultTeamShutdownToolDeps): ToolDefinition {
  void client

  return tool({
    description: "Request shutdown for a team member.",
    args: { teamRunId: tool.schema.string(), targetMemberName: tool.schema.string() },
    async execute(rawArgs, toolContext) {
      const args = TeamShutdownRequestArgsSchema.parse(rawArgs)
      const runtimeContext = toolContext as TeamLifecycleToolContext
      const { participant } = await resolveParticipant(args.teamRunId, runtimeContext.sessionID, config, deps)
      if (participant?.role !== "lead") throw new Error("team_shutdown_request is lead-only")
      await deps.requestShutdownOfMember(args.teamRunId, args.targetMemberName, participant.memberName, config)
      return JSON.stringify({ teamRunId: args.teamRunId, targetMemberName: args.targetMemberName, requesterName: participant.memberName, status: "shutdown_requested" })
    },
  })
}

export function createTeamApproveShutdownTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamShutdownToolDeps = defaultTeamShutdownToolDeps): ToolDefinition {
  void client

  return tool({
    description: "Approve a pending shutdown request.",
    args: { teamRunId: tool.schema.string(), memberName: tool.schema.string() },
    async execute(rawArgs, toolContext) {
      const args = TeamApproveShutdownArgsSchema.parse(rawArgs)
      const runtimeContext = toolContext as TeamLifecycleToolContext
      const { participant } = await resolveParticipant(args.teamRunId, runtimeContext.sessionID, config, deps)
      if (!participant || (participant.role !== "lead" && participant.memberName !== args.memberName)) throw new Error("team_approve_shutdown: caller must be target member or team lead")
      await deps.approveShutdown(args.teamRunId, args.memberName, participant.memberName, config)
      return JSON.stringify({ teamRunId: args.teamRunId, memberName: args.memberName, approverName: participant.memberName, status: "shutdown_approved" })
    },
  })
}

export function createTeamRejectShutdownTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamShutdownToolDeps = defaultTeamShutdownToolDeps): ToolDefinition {
  void client

  return tool({
    description: "Reject a pending shutdown request.",
    args: { teamRunId: tool.schema.string(), memberName: tool.schema.string(), reason: tool.schema.string() },
    async execute(rawArgs, toolContext) {
      const args = TeamRejectShutdownArgsSchema.parse(rawArgs)
      const runtimeContext = toolContext as TeamLifecycleToolContext
      const { participant } = await resolveParticipant(args.teamRunId, runtimeContext.sessionID, config, deps)
      if (!participant || (participant.role !== "lead" && participant.memberName !== args.memberName)) throw new Error("team_reject_shutdown: caller must be target member or team lead")
      await deps.rejectShutdown(args.teamRunId, args.memberName, args.reason, config)
      return JSON.stringify({ teamRunId: args.teamRunId, memberName: args.memberName, rejectedBy: participant.memberName, reason: args.reason, status: "shutdown_rejected" })
    },
  })
}
