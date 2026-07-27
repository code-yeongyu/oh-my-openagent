import { resolveCategory } from "../src/category"
import type { CategoryResolutionResult, SenpiModelRegistryPort } from "../src/category"

type QaModel = {
  readonly provider: string
  readonly id: string
}

function model(provider: string, id: string): QaModel {
  return { provider, id }
}

function registry(models: readonly QaModel[]): SenpiModelRegistryPort<QaModel> {
  return {
    getAvailable: () => models,
    find: (provider, modelId) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function resolved(
  category: string,
  availableModels: readonly QaModel[],
): Extract<CategoryResolutionResult<QaModel>, { readonly kind: "resolved" }> {
  const result = resolveCategory(category, {}, registry(availableModels))
  if (result.kind !== "resolved") {
    throw new Error(`${category} did not resolve: ${result.kind}`)
  }
  return result
}

const scenarios = {
  visualPrimary: resolved("visual-engineering", [model("anthropic", "claude-opus-5")]),
  visualKimiFallback: resolved("visual-engineering", [model("apitopia", "kimi-k3")]),
  visualFableFallback: resolved("visual-engineering", [model("anthropic", "claude-fable-5")]),
  quickPrimary: resolved("quick", [model("apitopia", "kimi-for-coding-highspeed")]),
  quickMiniFallback: resolved("quick", [model("quotio-openai", "gpt-5.4-mini-fast")]),
  quickHaikuFallback: resolved("quick", [model("anthropic-api", "claude-haiku-4-5")]),
  unspecifiedHighPrimary: resolved("unspecified-high", [model("apitopia", "kimi-k3")]),
  unspecifiedHighOpusFallback: resolved("unspecified-high", [model("anthropic", "claude-opus-5")]),
}

const observed = Object.fromEntries(
  Object.entries(scenarios).map(([name, result]) => [
    name,
    {
      selectedModel: result.modelSelection.selectedModel,
      variant: result.spec.variant ?? null,
      matchedFallback: result.modelSelection.matchedFallback,
    },
  ]),
)

console.log(JSON.stringify(observed, null, 2))
