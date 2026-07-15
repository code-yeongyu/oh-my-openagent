import { describe, expect, it } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import { assembleAgentConfig } from "./agent-config-assembly"
import type { AgentSources } from "./agent-config-types"

const PROJECT_AGENT_KEY = "repository-reviewer"
const PROJECT_AGENT = {
  name: PROJECT_AGENT_KEY,
  prompt: "project agent",
  mode: "subagent",
}

function createSources(overrides: Partial<AgentSources> = {}): AgentSources {
  return {
    userAgents: {},
    projectAgents: {},
    opencodeGlobalAgents: {},
    opencodeProjectAgents: {},
    pluginAgents: {},
    agentDefinitionAgents: {},
    opencodeConfigAgents: {},
    configAgent: undefined,
    customAgentSummaries: [],
    ...overrides,
  }
}

async function getProjectAgentSourceKeys(
  sources: AgentSources,
  sisyphusDisabled: boolean,
): Promise<readonly string[]> {
  const pluginConfig: OhMyOpenCodeConfig = {
    sisyphus_agent: {
      disabled: sisyphusDisabled,
      planner_enabled: false,
    },
  }
  const result = await assembleAgentConfig({
    config: { agent: sources.configAgent ?? {} },
    pluginConfig,
    builtinAgents: {
      sisyphus: {
        name: "Sisyphus - ultraworker",
        prompt: "builtin",
        mode: "primary",
      },
    },
    sources,
    currentModel: undefined,
    useTaskSystem: false,
    disabledAgentNames: new Set(),
  })
  return result.projectAgentSourceKeys
}

describe("assembleAgentConfig project provenance", () => {
  for (const sisyphusDisabled of [false, true]) {
    const branch = sisyphusDisabled ? "Sisyphus-disabled" : "Sisyphus-enabled"

    it(`#given project agent reflected in aggregate config #when assembling ${branch} path #then retains project provenance`, async () => {
      const sources = createSources({
        opencodeProjectAgents: { [PROJECT_AGENT_KEY]: PROJECT_AGENT },
        configAgent: { [PROJECT_AGENT_KEY]: { ...PROJECT_AGENT, prompt: "aggregate reflection" } },
      })

      const sourceKeys = await getProjectAgentSourceKeys(sources, sisyphusDisabled)

      expect(sourceKeys).toEqual([PROJECT_AGENT_KEY])
    })

    it(`#given project agent overridden by agent definition #when assembling ${branch} path #then revokes project provenance`, async () => {
      const sources = createSources({
        opencodeProjectAgents: { [PROJECT_AGENT_KEY]: PROJECT_AGENT },
        agentDefinitionAgents: { [PROJECT_AGENT_KEY]: { ...PROJECT_AGENT, prompt: "definition" } },
        configAgent: { [PROJECT_AGENT_KEY]: { ...PROJECT_AGENT, prompt: "aggregate reflection" } },
      })

      const sourceKeys = await getProjectAgentSourceKeys(sources, sisyphusDisabled)

      expect(sourceKeys).toEqual([])
    })

    it(`#given project agent overridden by opencode config #when assembling ${branch} path #then revokes project provenance`, async () => {
      const sources = createSources({
        opencodeProjectAgents: { [PROJECT_AGENT_KEY]: PROJECT_AGENT },
        opencodeConfigAgents: { [PROJECT_AGENT_KEY]: { ...PROJECT_AGENT, prompt: "opencode config" } },
        configAgent: { [PROJECT_AGENT_KEY]: { ...PROJECT_AGENT, prompt: "aggregate reflection" } },
      })

      const sourceKeys = await getProjectAgentSourceKeys(sources, sisyphusDisabled)

      expect(sourceKeys).toEqual([])
    })
  }

  it("#given aggregate config identity without project source #when assembling #then does not grant project provenance", async () => {
    const sources = createSources({
      configAgent: { [PROJECT_AGENT_KEY]: PROJECT_AGENT },
    })

    const sourceKeys = await getProjectAgentSourceKeys(sources, false)

    expect(sourceKeys).toEqual([])
  })
})
