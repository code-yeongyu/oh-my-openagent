import { z } from "zod"

import { getAgentConfigKey } from "../../../shared/agent-display-names"
import type { DelegatedModelConfig } from "../../../shared/model-resolution-types"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import { AGENT_ELIGIBILITY_REGISTRY } from "../types"
import type { Member } from "../types"

const REQUIRED_TEAM_MEMBER_TOOLS = [
  "team_send_message",
  "team_task_list",
  "team_task_get",
  "team_task_update",
  "team_status",
] as const

const AgentPermissionRuleSchema = z.object({
  permission: z.string(),
  pattern: z.string(),
  action: z.enum(["allow", "ask", "deny"]),
})

const OpenCodeAgentSchema = z.looseObject({
  name: z.string(),
  mode: z.enum(["subagent", "primary", "all"]),
  native: z.boolean().nullish(),
  hidden: z.boolean().nullish(),
  permission: z.array(AgentPermissionRuleSchema),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }).nullish(),
  variant: z.string().nullish(),
  prompt: z.string().nullish(),
})

const OpenCodeAgentRegistryResponseSchema = z.union([
  z.array(OpenCodeAgentSchema),
  z.object({ data: z.array(OpenCodeAgentSchema) }),
])

type SubagentMember = Extract<Member, { kind: "subagent_type" }>
type OpenCodeAgent = z.infer<typeof OpenCodeAgentSchema>

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

function isToolDisabled(agent: OpenCodeAgent, tool: string): boolean {
  const effectiveRule = agent.permission.findLast((rule) => matchesOpenCodeWildcard(tool, rule.permission))
  return effectiveRule?.pattern === "*" && effectiveRule.action === "deny"
}

function getMissingTeamTools(agent: OpenCodeAgent): readonly string[] {
  return REQUIRED_TEAM_MEMBER_TOOLS.filter((tool) => isToolDisabled(agent, tool))
}

function parseAgentRegistry(response: unknown): readonly OpenCodeAgent[] {
  const result = OpenCodeAgentRegistryResponseSchema.safeParse(response)
  if (!result.success) {
    throw new ProjectAgentMemberError(`OpenCode returned an invalid final agent registry: ${result.error.message}`)
  }

  return Array.isArray(result.data) ? result.data : result.data.data
}

function resolveProjectAgentModel(agent: OpenCodeAgent): DelegatedModelConfig | undefined {
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
  const canonicalSubagentType = getAgentConfigKey(member.subagent_type)
  if (AGENT_ELIGIBILITY_REGISTRY[canonicalSubagentType] !== undefined) {
    return undefined
  }

  const registry = parseAgentRegistry(await ctx.client.app.agents({ query: { directory: options.directory } }))
  const agent = registry.find((candidate) => candidate.name === member.subagent_type)
  if (!agent) {
    throw new ProjectAgentMemberError(
      `Project agent '${member.subagent_type}' is absent from the final OpenCode agent registry for '${options.directory}'.`,
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

  const missingTools = getMissingTeamTools(agent)
  if (missingTools.length > 0) {
    throw new ProjectAgentMemberError(
      `Project agent '${member.subagent_type}' denies required Team Mode tools: ${missingTools.join(", ")}.`,
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
