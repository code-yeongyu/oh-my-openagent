import type { V2AgentInfo, V2PluginContext } from "../context-types"

function toV1Agent(agent: V2AgentInfo): Record<string, unknown> {
  return {
    name: agent.id,
    description: agent.description,
    mode: agent.mode,
    builtIn: false,
    native: false,
    hidden: agent.hidden,
    color: agent.color,
    steps: agent.steps,
    model: agent.model === undefined ? undefined : { providerID: agent.model.providerID, modelID: agent.model.id },
    permission: [],
    options: {},
  }
}

/** `app.agents()` in the 1.x shape `{ data: Agent[] }`, built from the host's agent list. */
export function createAppNamespace(context: V2PluginContext) {
  return {
    agents: async () => ({ data: (await context.agent.list()).data.map(toV1Agent) }),
  }
}
