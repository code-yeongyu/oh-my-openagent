import { describe, expect, test } from "bun:test"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { CODE_REVIEWER_AGENT } from "./builtin/code-reviewer"
import { GATE_REVIEWER_AGENT } from "./builtin/gate-reviewer"
import { QA_EXECUTOR_AGENT } from "./builtin/qa-executor"
import { resolveAgent } from "./resolve-agent"
import type { AgentDefinition } from "./types"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

function model(provider: string, id: string): FakeModel {
  return { provider, id }
}

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

const CATEGORIZED_AGENT_TOOLS = [
  { pattern: "read", allow: true },
  { pattern: "bash", allow: true },
] as const

function categorizedAgent(
  categories: readonly string[],
  extra: Partial<AgentDefinition> = {},
): Readonly<Record<string, AgentDefinition>> {
  const definition: AgentDefinition = {
    name: "categorized",
    prompt: "Audit the diff and report",
    tools: CATEGORIZED_AGENT_TOOLS,
    categories,
    ...extra,
  }
  return { categorized: definition }
}

function expectResolved(result: ReturnType<typeof resolveAgent>) {
  if (result.kind !== "resolved") throw new Error(`Expected resolved agent, got ${result.kind}`)
  return result
}

function expectUnavailable(result: ReturnType<typeof resolveAgent>) {
  if (result.kind !== "model_unavailable") throw new Error(`Expected model_unavailable, got ${result.kind}`)
  return result
}

describe("resolveAgent category stage", () => {
  test("#given categories deep then unspecified-high #when both resolve #then the deep model wins and the later category extends the runtime chain", () => {
    // given
    const agents = categorizedAgent(["deep", "unspecified-high"])
    const models = registry([model("openai", "gpt-5.6-sol"), model("anthropic", "claude-opus-5")])

    // when
    const result = expectResolved(resolveAgent("categorized", agents, models))

    // then
    expect(result.model).toBe("openai/gpt-5.6-sol")
    expect(result.resolved_model?.reasoning).toBe("medium")
    expect(result.fallback_models?.map((record) => record.display)).toContain("anthropic/claude-opus-5")
    for (const record of result.fallback_models ?? []) {
      expect(record.source).toBe("agent")
    }
    expect(result.requested_model?.source).toBe("agent")
  })

  test("#given categories deep then unspecified-high #when the deep gate model is absent #then the second category supplies the model", () => {
    // given
    const agents = categorizedAgent(["deep", "unspecified-high"])
    const models = registry([model("anthropic", "claude-opus-5")])

    // when
    const result = expectResolved(resolveAgent("categorized", agents, models))

    // then
    expect(result.model).toBe("anthropic/claude-opus-5")
    expect(result.resolved_model?.reasoning).toBe("xhigh")
  })

  test("#given categories deep then unspecified-low #when only the low chain head is available #then it resolves at that chain head", () => {
    // given
    const agents = categorizedAgent(["deep", "unspecified-low"])
    const models = registry([model("xai", "grok-4.6")])

    // when
    const result = expectResolved(resolveAgent("categorized", agents, models))

    // then
    expect(result.model).toBe("xai/grok-4.6")
    expect(result.resolved_model?.reasoning).toBe("xhigh")
  })

  test("#given a single unspecified-high category #when its chain head is available #then the agent runs on it", () => {
    // given
    const agents = categorizedAgent(["unspecified-high"])
    const models = registry([model("anthropic", "claude-opus-5")])

    // when
    const result = expectResolved(resolveAgent("categorized", agents, models))

    // then
    expect(result.model).toBe("anthropic/claude-opus-5")
    expect(result.resolved_model?.reasoning).toBe("xhigh")
  })

  test("#given an omo.json deep category model override #when the agent resolves #then the user model reaches the agent", () => {
    // given
    const agents = categorizedAgent(["deep", "unspecified-high"])
    const models = registry([model("openai", "gpt-5.6-terra")])
    const omoConfig: OmoConfig = { categories: { deep: { model: "openai/gpt-5.6-terra" } } }

    // when
    const result = expectResolved(resolveAgent("categorized", agents, models, { omoConfig }))

    // then
    expect(result.model).toBe("openai/gpt-5.6-terra")
  })

  test("#given a category that carries a prompt append and tools #when the agent resolves through it #then the agent keeps its own prompt and allowlist", () => {
    // given
    const agents = categorizedAgent(["deep", "unspecified-high"])
    const models = registry([model("openai", "gpt-5.6-sol")])

    // when
    const result = expectResolved(resolveAgent("categorized", agents, models))

    // then
    expect(result.instructions).toBe("Audit the diff and report")
    expect(result.toolAllowlist).toEqual(["read", "bash"])
  })

  test("#given no category resolves #when the agent resolves #then it reports the first category builtin model as attempted", () => {
    // given
    const agents = categorizedAgent(["deep", "unspecified-high"])
    const models = registry([model("google", "gemini-3.1-pro")])

    // when
    const result = expectUnavailable(resolveAgent("categorized", agents, models))

    // then
    expect(result.attemptedModel).toBe("openai/gpt-5.6-sol")
  })

  test("#given a definition model alongside categories #when both are available #then the direct model wins", () => {
    // given
    const agents = categorizedAgent(["deep"], { model: "acme/custom-1" })
    const models = registry([model("acme", "custom-1"), model("openai", "gpt-5.6-sol")])

    // when
    const result = expectResolved(resolveAgent("categorized", agents, models))

    // then
    expect(result.model).toBe("acme/custom-1")
  })

  test("#given no registry #when a categorized agent resolves #then the first category builtin model is the attempted model", () => {
    // given
    const agents = categorizedAgent(["deep"])

    // when
    const result = expectUnavailable(resolveAgent("categorized", agents, undefined))

    // then
    expect(result.attemptedModel).toBe("openai/gpt-5.6-sol")
  })

  test("#given the ulw reviewer builtins #when reading their definitions #then each declares its ordered model-policy categories", () => {
    // given / when
    const declared = {
      [CODE_REVIEWER_AGENT.name]: CODE_REVIEWER_AGENT.categories,
      [QA_EXECUTOR_AGENT.name]: QA_EXECUTOR_AGENT.categories,
      [GATE_REVIEWER_AGENT.name]: GATE_REVIEWER_AGENT.categories,
    }

    // then
    expect(declared).toEqual({
      "omo-senpi-code-reviewer": ["unspecified-high"],
      "omo-senpi-qa-executor": ["deep", "unspecified-low"],
      "omo-senpi-gate-reviewer": ["deep", "unspecified-high"],
    })
  })

  test("#given a category whose head model is unavailable #when a later rung wins #then requested_model is the selected model, not the head", () => {
    // given: unspecified-high's head is anthropic/claude-opus-5; only its glm-5.3 rung exists here.
    const definition: AgentDefinition = { name: "probe", categories: ["unspecified-high"] }
    const glmOnlyRegistry = registry([model("zai-coding-plan", "glm-5.3")])

    // when
    const resolution = resolveAgent("probe", { probe: definition }, glmOnlyRegistry)

    // then: the retry chain must lead with the model the child actually runs.
    expect(resolution.kind).toBe("resolved")
    if (resolution.kind !== "resolved") return
    expect(resolution.model).toBe("zai-coding-plan/glm-5.3")
    expect(resolution.requested_model?.display).toBe("zai-coding-plan/glm-5.3")
    // The unavailable head may still ride the retry tail (it can come back), but never ahead of
    // the model the child actually runs.
    const chain = [resolution.requested_model, ...(resolution.fallback_models ?? [])]
    expect(chain[0]?.display).toBe("zai-coding-plan/glm-5.3")
  })

  test("#given a malformed available-model container #when find still resolves the category model #then the agent keeps the find-only fallback", () => {
    // given: getAvailable() returns a non-array (unparseable), but find() works. The direct-model
    // path documents this degradation, so a categorized agent must not lose it.
    const definition: AgentDefinition = { name: "probe", categories: ["unspecified-high"] }
    const available = [model("anthropic", "claude-opus-5")]
    const malformedRegistry = {
      getAvailable: (): unknown => ({ notAnArray: true }),
      find: (provider: string, modelId: string) =>
        available.find((candidate) => candidate.provider === provider && candidate.id === modelId),
    }

    // when
    const resolution = resolveAgent("probe", { probe: definition }, malformedRegistry)

    // then
    expect(resolution.kind).toBe("resolved")
    if (resolution.kind !== "resolved") return
    expect(resolution.model).toBe("anthropic/claude-opus-5")
  })

  test("#given a user category model override that is unavailable #when resolution fails #then the attempted model names the user model, not the builtin", () => {
    // given: the user pointed deep at their own model; neither it nor the builtin is in the registry.
    const definition: AgentDefinition = { name: "probe", categories: ["deep"] }
    const omoConfig = { categories: { deep: { model: "openai/my-custom-model" } } } as OmoConfig
    const unrelatedRegistry = registry([model("google", "gemini-3.1-pro")])

    // when
    const resolution = resolveAgent("probe", { probe: definition }, unrelatedRegistry, { omoConfig })

    // then: troubleshooting must point at what the user configured.
    expect(resolution.kind).toBe("model_unavailable")
    if (resolution.kind !== "model_unavailable") return
    expect(resolution.attemptedModel).toBe("openai/my-custom-model")
  })

  test("#given a malformed availability container #when find returns a non-model object #then the agent refuses it instead of laundering it into a model", () => {
    // given: find() hands back an error envelope, not a model. The direct-model path validates the
    // shape via findExactAgentModel and reports model_unavailable; the category path must match.
    const definition: AgentDefinition = { name: "probe", categories: ["deep"] }
    const junkRegistry = {
      getAvailable: (): unknown => ({ notAnArray: true }),
      find: (): unknown => ({ error: "quota exceeded", retryAfter: 30 }),
    }

    // when
    const resolution = resolveAgent("probe", { probe: definition }, junkRegistry)

    // then
    expect(resolution.kind).toBe("model_unavailable")
  })
})
