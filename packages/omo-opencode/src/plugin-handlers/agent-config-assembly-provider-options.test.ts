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

function makeParams(agents: Record<string, Record<string, unknown>>): AssembleParams {
  return {
    config: {},
    pluginConfig: makePluginConfig({ sisyphus_agent: { planner_enabled: false } }),
    builtinAgents: agents as AssembleParams["builtinAgents"],
    sources: emptySources(),
    currentModel: undefined,
    useTaskSystem: false,
    disabledAgentNames: new Set<string>(),
  }
}

function resolved(params: AssembleParams): Record<string, Record<string, unknown>> {
  return params.config.agent as Record<string, Record<string, unknown>>
}

describe("assembleAgentConfig provider options folding (#5479)", () => {
  test("#given an agent with top-level providerOptions #when assembled #then it is folded into options and the key is dropped", async () => {
    //#given
    const params = makeParams({
      sisyphus: {
        name: "sisyphus",
        model: "openai/gpt-5.5",
        mode: "primary",
        prompt: "s",
        providerOptions: { thinking_token_budget: 1024, chat_template_kwargs: { enable_thinking: false } },
      },
      oracle: { name: "oracle", model: "openai/gpt-5.5", mode: "subagent", prompt: "o" },
    })

    //#when
    await assembleAgentConfig(params)

    //#then
    const agents = resolved(params)
    expect(agents.sisyphus.options).toEqual({
      thinking_token_budget: 1024,
      chat_template_kwargs: { enable_thinking: false },
    })
    expect("providerOptions" in agents.sisyphus).toBe(false)
  })

  test("#given an agent with existing options and providerOptions #when assembled #then they are deep-merged", async () => {
    //#given
    const params = makeParams({
      sisyphus: {
        name: "sisyphus",
        model: "openai/gpt-5.5",
        mode: "primary",
        prompt: "s",
        options: { existing: 1, chat_template_kwargs: { keep: true } },
        providerOptions: { added: 2, chat_template_kwargs: { enable_thinking: false } },
      },
    })

    //#when
    await assembleAgentConfig(params)

    //#then
    const agents = resolved(params)
    expect(agents.sisyphus.options).toEqual({
      existing: 1,
      added: 2,
      chat_template_kwargs: { keep: true, enable_thinking: false },
    })
    expect("providerOptions" in agents.sisyphus).toBe(false)
  })

  test("#given an agent without providerOptions #when assembled #then options is left untouched", async () => {
    //#given
    const params = makeParams({
      sisyphus: { name: "sisyphus", model: "openai/gpt-5.5", mode: "primary", prompt: "s" },
      oracle: { name: "oracle", model: "openai/gpt-5.5", mode: "subagent", prompt: "o" },
    })

    //#when
    await assembleAgentConfig(params)

    //#then
    const agents = resolved(params)
    expect(agents.oracle.options).toBeUndefined()
    expect("providerOptions" in agents.oracle).toBe(false)
  })
})
