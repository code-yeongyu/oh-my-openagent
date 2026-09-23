import assert from "node:assert/strict"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "../../../packages/model-core/src/model-requirements"
import { resolveModelWithFallback } from "../../../packages/model-core/src/model-resolver"
import { resolveCategory } from "../../../packages/senpi-task/src/category"

const scenarios = [
  { category: "deep-low", ids: ["gpt-6-sol", "gpt-5.6-sol"], provider: "chatgpt-subscription", expected: "gpt-6-sol" },
  { category: "deep-low", ids: ["gpt-5.6-sol"], provider: "chatgpt-subscription", expected: "gpt-5.6-sol" },
  { category: "deep-high", ids: ["gpt-6-astra"], provider: "chatgpt-subscription", expected: "gpt-6-astra" },
  { category: "quick", ids: ["gpt-6-luna-fast"], provider: "chatgpt-subscription", expected: "gpt-6-luna-fast" },
  { category: "artistry", ids: ["claude-opus-5-5", "claude-opus-5"], provider: "anthropic", expected: "claude-opus-5-5" },
  { category: "artistry", ids: ["claude-opus-5"], provider: "github-copilot", expected: "claude-opus-5" },
  { category: "artistry", ids: ["kimi-k3"], provider: "opencode-go", expected: "kimi-k3" },
  { category: "unspecified-high", ids: ["glm-5.3"], provider: "opencode-go", expected: "glm-5.3" },
]

for (const scenario of scenarios) {
  const models = scenario.ids.map(id => ({ provider: scenario.provider, id }))
  const registry = {
    getAvailable: () => models,
    find: (provider: string, id: string) => models.find(model => model.provider === provider && model.id === id),
  }
  const senpi = resolveCategory(scenario.category, {}, registry)
  assert.equal(senpi.kind, "resolved")
  if (senpi.kind !== "resolved") throw new Error(`Unresolved ${scenario.category}`)
  assert.equal(senpi.spec.modelId, scenario.expected)
  const core = resolveModelWithFallback({
    fallbackChain: CATEGORY_MODEL_REQUIREMENTS[scenario.category].fallbackChain,
    availableModels: new Set(models.map(model => `${model.provider}/${model.id}`)),
    systemDefaultModel: "system/default",
  })
  assert.equal(core?.model, `${scenario.provider}/${scenario.expected}`)
  console.log(`PASS core+senpi ${scenario.category}: ${scenario.provider}/${scenario.expected}`)
}

for (const provider of ["anthropic", "github-copilot"]) {
  const id = provider === "anthropic" ? "claude-opus-5-5" : "claude-opus-5"
  const resolved = resolveModelWithFallback({
    fallbackChain: AGENT_MODEL_REQUIREMENTS.prometheus.fallbackChain,
    availableModels: new Set([`${provider}/${id}`]),
    systemDefaultModel: "system/default",
  })
  assert.equal(resolved?.model, `${provider}/${id}`)
  console.log(`PASS prometheus: ${provider}/${id}`)
}

const empty = resolveCategory("artistry", {}, { getAvailable: () => [], find: () => undefined })
assert.equal(empty.kind, "model_unavailable")
console.log("PASS empty registry: model_unavailable")
