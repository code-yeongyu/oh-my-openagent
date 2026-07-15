import { getAgentConfigKey } from "../../../shared/agent-display-names"
import { hasProjectAgentOrigin } from "../../../shared"
import type { DelegatedModelConfig } from "../../../shared/model-resolution-types"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import { AGENT_ELIGIBILITY_REGISTRY } from "../types"
import type { Member } from "../types"
import {
  FinalOpenCodeAgentRegistryError,
  parseFinalOpenCodeAgentRegistry,
  type FinalOpenCodeAgent,
} from "../final-open-code-agent-registry"

const REQUIRED_TEAM_MEMBER_TOOLS = [
  "team_send_message",
  "team_task_list",
  "team_task_get",
  "team_task_update",
  "team_status",
] as const

type SubagentMember = Extract<Member, { kind: "subagent_type" }>

export type ProjectAgentMemberResolution = {
  readonly memberName: string
  readonly agentToUse: string
  readonly exactAgent: true
  readonly model: DelegatedModelConfig | undefined
  readonly fallbackChain: undefined
  readonly systemContent: undefined
}

export type ProjectAgentMemberOptions = {
  readonly directory: string
  readonly isLead: boolean
  readonly parentSessionPermission?: FinalOpenCodeAgent["permission"]
  readonly teamSessionPermission?: FinalOpenCodeAgent["permission"]
}

export class ProjectAgentMemberError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProjectAgentMemberError"
  }
}

function matchesOpenCodeWildcard(value: string, pattern: string): boolean {
  const normalizedValue = value.replaceAll("\\", "/")
  const normalizedPattern = pattern.replaceAll("\\", "/")
  const expression = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  const flags = process.platform === "win32" ? "si" : "s"
  return new RegExp(`^${expression}$`, flags).test(normalizedValue)
}

function isToolAllowed(rules: FinalOpenCodeAgent["permission"], tool: string): boolean {
  const effectiveRule = rules.findLast((rule) => matchesOpenCodeWildcard(tool, rule.permission))
  return effectiveRule?.pattern === "*" && effectiveRule.action === "allow"
}

function getMissingTeamTools(rules: FinalOpenCodeAgent["permission"]): readonly string[] {
  return REQUIRED_TEAM_MEMBER_TOOLS.filter((tool) => !isToolAllowed(rules, tool))
}

function resolveProjectAgentModel(agent: FinalOpenCodeAgent): DelegatedModelConfig | undefined {
  if (!agent.model) {
    return undefined
  }

  return {
    providerID: agent.model.providerID,
    modelID: agent.model.modelID,
    ...(agent.variant ? { variant: agent.variant } : {}),
  }
}

export async function resolveProjectAgentMember(
  member: SubagentMember,
  ctx: Pick<ExecutorContext, "client">,
  options: ProjectAgentMemberOptions,
): Promise<ProjectAgentMemberResolution | undefined> {
  let registry: readonly FinalOpenCodeAgent[]
  try {
    registry = parseFinalOpenCodeAgentRegistry(
      await ctx.client.app.agents({ query: { directory: options.directory } }),
    )
  } catch (error) {
    if (error instanceof FinalOpenCodeAgentRegistryError) {
      throw new ProjectAgentMemberError(error.message)
    }
    throw error
  }
  const agent = registry.find((candidate) => candidate.name === member.subagent_type)
  const canonicalSubagentType = getAgentConfigKey(member.subagent_type)
  if (!agent && AGENT_ELIGIBILITY_REGISTRY[canonicalSubagentType] !== undefined) {
    return undefined
  }
  if (!agent) {
    throw new ProjectAgentMemberError(
      `Project agent '${member.subagent_type}' is absent from the final OpenCode agent registry for '${options.directory}'.`,
    )
  }
  if (!hasProjectAgentOrigin(options.directory, agent.name)) {
    throw new ProjectAgentMemberError(
      `Agent '${member.subagent_type}' did not originate from .opencode/agents for '${options.directory}'.`,
    )
  }
  if (agent.native !== false) {
    throw new ProjectAgentMemberError(
      `Native OpenCode agent '${member.subagent_type}' is outside Team Mode's static eligibility registry and cannot join a team.`,
    )
  }
  if (agent.hidden === true) {
    throw new ProjectAgentMemberError(`Project agent '${member.subagent_type}' is hidden and cannot join a team.`)
  }
  if (agent.mode !== "subagent" && agent.mode !== "all") {
    throw new ProjectAgentMemberError(
      `Project agent '${member.subagent_type}' has mode '${agent.mode}'; Team Mode requires mode 'subagent' or 'all'.`,
    )
  }
  if (options.isLead) {
    throw new ProjectAgentMemberError(
      `Project agent '${member.subagent_type}' is member-only and cannot be selected or reused as a team lead.`,
    )
  }

  const effectivePermission = [
    ...agent.permission,
    ...(options.parentSessionPermission ?? []),
    ...(options.teamSessionPermission ?? []),
  ]
  const missingTools = getMissingTeamTools(effectivePermission)
  if (missingTools.length > 0) {
    throw new ProjectAgentMemberError(
      `Project agent '${member.subagent_type}' does not allow required Team Mode tools: ${missingTools.join(", ")}.`,
    )
  }

  return {
    memberName: member.name,
    agentToUse: agent.name,
    exactAgent: true,
    model: resolveProjectAgentModel(agent),
    fallbackChain: undefined,
    systemContent: undefined,
  }
}
