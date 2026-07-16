import { describe, test, expect } from "bun:test"

import type { OhMyOpenCodeConfig } from "../config"
import { assembleAgentConfig } from "./agent-config-assembly"

type AssembleParams = Parameters<typeof assembleAgentConfig>[0]

function makePluginConfig(partial: Partial<OhMyOpenCodeConfig>): OhMyOpenCodeConfig {
  return {
    git_master: { commit_footer: true, include_co_authored_by: true, git_env_prefix: "GIT_MASTER=1" },
    ...partial,
  } as OhMyOpenCodeConfig
}

function emptySources(): AssembleParams["sources"] {
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
  }
}

// Resolved builtin agents as createBuiltinAgents would hand them to assembly:
// each already carries a concrete model. Planner is disabled in these tests so
// Prometheus is not built and no network/model resolution runs.
function builtinAgents(): Record<string, Record<string, unknown>> {
  return {
    sisyphus: { name: "sisyphus", model: "anthropic/claude-opus-4-7", variant: "max", mode: "primary", prompt: "s" },
    hephaestus: { name: "hephaestus", model: "openai/gpt-5.6-sol", mode: "primary", prompt: "h" },
    oracle: { name: "oracle", model: "opencode-go/glm-5.2", mode: "subagent", prompt: "o" },
    librarian: { name: "librarian", model: "openai/gpt-5.4-mini-fast", mode: "subagent", prompt: "l" },
    "multimodal-looker": { name: "multimodal-looker", model: "openai/gpt-5-nano", mode: "subagent", prompt: "m" },
    atlas: { name: "atlas", model: "anthropic/claude-sonnet-4-6", mode: "primary", prompt: "a" },
  }
}

function makeParams(
  pluginConfig: OhMyOpenCodeConfig,
  agents: Record<string, Record<string, unknown>>,
): AssembleParams {
  return {
    config: {},
    pluginConfig,
    builtinAgents: agents as AssembleParams["builtinAgents"],
    sources: emptySources(),
    currentModel: undefined,
    useTaskSystem: false,
    disabledAgentNames: new Set<string>(),
  }
}

function resolvedAgents(params: AssembleParams): Record<string, { model?: string; variant?: string }> {
  return params.config.agent as Record<string, { model?: string; variant?: string }>
}

describe("assembleAgentConfig inherit_model", () => {
  test("#given inherit_model is off #when config is assembled #then subagents keep their own resolved models", async () => {
    //#given
    const params = makeParams(makePluginConfig({ sisyphus_agent: { planner_enabled: false } }), builtinAgents())

    //#when
    await assembleAgentConfig(params)

    //#then
    const agents = resolvedAgents(params)
    expect(agents.oracle.model).toBe("opencode-go/glm-5.2")
    expect(agents.librarian.model).toBe("openai/gpt-5.4-mini-fast")
  })

  test("#given inherit_model is on #when config is assembled #then eligible subagents adopt Sisyphus model and variant", async () => {
    //#given
    const params = makeParams(
      makePluginConfig({ sisyphus_agent: { planner_enabled: false, inherit_model: true } }),
      builtinAgents(),
    )

    //#when
    await assembleAgentConfig(params)

    //#then
    const agents = resolvedAgents(params)
    expect(agents.oracle.model).toBe("anthropic/claude-opus-4-7")
    expect(agents.oracle.variant).toBe("max")
    expect(agents.librarian.model).toBe("anthropic/claude-opus-4-7")
    expect(agents.librarian.variant).toBe("max")
  })

  test("#given inherit_model is on #when config is assembled #then provider-locked and special agents keep their own model", async () => {
    //#given
    const params = makeParams(
      makePluginConfig({ sisyphus_agent: { planner_enabled: false, inherit_model: true } }),
      builtinAgents(),
    )

    //#when
    await assembleAgentConfig(params)

    //#then Hephaestus (requiresProvider), multimodal-looker (vision), Atlas (orchestrator) are untouched
    const agents = resolvedAgents(params)
    expect(agents.hephaestus.model).toBe("openai/gpt-5.6-sol")
    expect(agents["multimodal-looker"].model).toBe("openai/gpt-5-nano")
    expect(agents.atlas.model).toBe("anthropic/claude-sonnet-4-6")
  })

  test("#given inherit_model is on and oracle has an explicit model #when config is assembled #then the explicit model wins", async () => {
    //#given the user pinned oracle to a specific model
    const agents = builtinAgents()
    agents.oracle.model = "user/pinned"
    const params = makeParams(
      makePluginConfig({
        sisyphus_agent: { planner_enabled: false, inherit_model: true },
        agents: { oracle: { model: "user/pinned" } },
      }),
      agents,
    )

    //#when
    await assembleAgentConfig(params)

    //#then
    expect(resolvedAgents(params).oracle.model).toBe("user/pinned")
  })
})
