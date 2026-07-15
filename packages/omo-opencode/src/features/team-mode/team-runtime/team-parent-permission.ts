import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import { getAgentConfigKey } from "../../../shared/agent-display-names"
import { parseFinalOpenCodeAgentRegistry, type FinalOpenCodeAgent } from "../final-open-code-agent-registry"

type ResolveTeamParentPermissionParams = {
  readonly ctx: ExecutorContext
  readonly leadSessionId: string
  readonly callerAgentTypeId: string | undefined
}

export class TeamParentPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TeamParentPermissionError"
  }
}

export async function resolveTeamParentPermission(
  params: ResolveTeamParentPermissionParams,
): Promise<FinalOpenCodeAgent["permission"]> {
  const parentSession = await params.ctx.client.session.get({
    path: { id: params.leadSessionId },
    query: { directory: params.ctx.directory },
  })
  if (parentSession.error || !parentSession.data) {
    throw new TeamParentPermissionError(`Failed to load parent session permission for '${params.leadSessionId}'.`)
  }

  if (!params.callerAgentTypeId) {
    return [...(parentSession.data.permission ?? [])]
  }

  const registry = parseFinalOpenCodeAgentRegistry(
    await params.ctx.client.app.agents({ query: { directory: params.ctx.directory } }),
  )
  const callerAgentConfigKey = getAgentConfigKey(params.callerAgentTypeId)
  const matchingAgents = registry.filter((agent) => getAgentConfigKey(agent.name) === callerAgentConfigKey)
  if (matchingAgents.length !== 1) {
    throw new TeamParentPermissionError(`Failed to load parent agent permission for '${params.callerAgentTypeId}'.`)
  }
  const parentAgent = matchingAgents[0]

  return [
    ...parentAgent.permission.filter((rule) => rule.action === "deny"),
    ...(parentSession.data.permission ?? []),
  ]
}
