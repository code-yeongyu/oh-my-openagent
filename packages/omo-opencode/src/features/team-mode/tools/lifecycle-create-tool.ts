import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getAgentConfigKey } from "../../../shared/agent-display-names"
import type { OpencodeClient } from "../../../tools/delegate-task/types"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { resolveCallerTeamLead } from "../resolve-caller-team-lead"
import { loadTeamSpec } from "@oh-my-opencode/team-core/team-registry/loader"
import { createTeamRun } from "../team-runtime/create"
import { listActiveTeams, loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store"
import { AGENT_ELIGIBILITY_REGISTRY } from "@oh-my-opencode/team-core/types"
import { findParticipantRuntime, sanitizeRuntimeState, type TeamLifecycleToolContext } from "./lifecycle-participant"
import {
  parseInlineTeamSpec,
  parseTeamCreateArgs,
  resolveDefaultInlineCategory,
  type TeamCreateExecutorConfig,
} from "./lifecycle-inline-spec"

const TeamCreateInlineMemberToolSchema = tool.schema.object({
  name: tool.schema.string().optional().describe("Member name, kebab-case or natural text; normalized before team creation."),
  kind: tool.schema.enum(["category", "subagent_type"]).optional().describe("Member kind. Use category for category-routed workers, or subagent_type for a specific eligible agent."),
  category: tool.schema.string().optional().describe("Required for category members unless a fallback category can be inferred. Examples: quick, unspecified-low, unspecified-high, deep, ultrabrain, visual-engineering, writing, artistry, git, data-analysis."),
  subagent_type: tool.schema.string().optional().describe("Required for subagent_type members. Eligible examples: sisyphus, atlas, sisyphus-junior."),
  prompt: tool.schema.string().optional().describe("Task prompt for this member. Category members need a concrete work prompt."),
  systemPrompt: tool.schema.string().optional().describe("Legacy alias for prompt; normalized before team creation."),
  loadSkills: tool.schema.array(tool.schema.string()).optional().describe("Optional skills to load for this member."),
  role: tool.schema.string().optional().describe("Optional natural-language role used to build a prompt when prompt is omitted."),
  description: tool.schema.string().optional().describe("Optional natural-language description used to build a prompt when prompt is omitted."),
})

const TeamCreateInlineSpecToolSchema = tool.schema.union([
  tool.schema.object({
    name: tool.schema.string().describe("Team name, kebab-case or natural text; normalized before team creation."),
    description: tool.schema.string().optional().describe("Optional team description."),
    leadAgentId: tool.schema.string().optional().describe("Optional member name to use as team lead."),
    lead: TeamCreateInlineMemberToolSchema.optional().describe("Optional explicit lead member."),
    members: tool.schema.array(TeamCreateInlineMemberToolSchema).describe("Team members; members must be a flat array, not an object or nested groups. Provide 1-8 members."),
    teamAllowedPaths: tool.schema.array(tool.schema.string()).optional().describe("Optional paths the team may access."),
    sessionPermission: tool.schema.string().optional().describe("Optional session permission policy."),
  }),
  tool.schema.string().describe("JSON string containing the same inline team spec object."),
])

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
      inline_spec: TeamCreateInlineSpecToolSchema.optional().describe("Inline team spec object or JSON string. Provide exactly one of teamName or inline_spec; members must be a flat array, e.g. { name: \"project-analysis-team\", members: [{ name: \"structure-analyst\", category: \"quick\", prompt: \"Analyze project structure.\" }] }."),
      leadSessionId: tool.schema.string().optional().describe("Optional non-empty session ID override. Usually omit this and let team_create use the current session."),
    },
    async execute(rawArgs, toolContext) {
      const args = parseTeamCreateArgs(rawArgs)
      const runtimeContext = toolContext as TeamLifecycleToolContext
      const leadSessionId = args.leadSessionId ?? runtimeContext.sessionID
      if (!leadSessionId) throw new Error("team_create requires leadSessionId or tool context sessionID")
      const projectRoot = typeof runtimeContext.directory === "string" ? runtimeContext.directory : process.cwd()
      const callerTeamLead = resolveCallerTeamLead(runtimeContext.agent)
      if (callerTeamLead.displayName !== undefined) {
        const callerAgentKey = getAgentConfigKey(callerTeamLead.displayName)
        const callerRegistryEntry = AGENT_ELIGIBILITY_REGISTRY[callerAgentKey]
        if (callerRegistryEntry?.verdict === "hard-reject") {
          throw new Error(`team_create denied: caller '${callerAgentKey}' is a hard-reject agent and cannot create teams regardless of an explicit 'lead' in the spec. ${callerRegistryEntry.rejectionMessage ?? `Agent '${callerAgentKey}' is not eligible to lead a team.`}`)
        }
      }
      const defaultCategoryName = resolveDefaultInlineCategory(executorConfig?.userCategories)
      const spec = args.teamName
        ? await deps.loadTeamSpec(args.teamName, config, projectRoot, {
            callerTeamLead,
            allowUnknownSubagentTypes: true,
          })
        : parseInlineTeamSpec(args.inline_spec, { callerTeamLead, defaultCategoryName })
      const participantRuntime = await findParticipantRuntime(leadSessionId, config, deps)
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
