import { resolveCategory } from "../src/category"
import type { SenpiModelRegistryPort } from "../src/category"

type QaModel = {
  readonly provider: string
  readonly id: string
  readonly name: string
}

function model(provider: string, id: string): QaModel {
  return { provider, id, name: `${provider}/${id}` }
}

function registry(models: readonly QaModel[]): SenpiModelRegistryPort<QaModel> {
  return {
    getAvailable: () => models,
    find: (provider, modelId) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

const happy = resolveCategory("ultrabrain", {}, registry([model("openai", "gpt-5.5")]))
requireCondition(happy.kind === "resolved", "happy scenario did not resolve")
if (happy.kind !== "resolved") {
  throw new Error("happy scenario did not resolve")
}
requireCondition(happy.spec.provider === "openai", "happy provider mismatch")
requireCondition(happy.spec.modelId === "gpt-5.5", "happy model mismatch")
requireCondition(happy.spec.variant === "xhigh", "happy variant mismatch")
requireCondition(happy.spec.prompt_append?.includes("DEEP LOGICAL REASONING") === true, "happy prompt missing")

const disabled = resolveCategory(
  "ultrabrain",
  { categories: { ultrabrain: { disable: true } } },
  registry([model("openai", "gpt-5.5")]),
)
requireCondition(disabled.kind === "disabled", "disabled scenario did not return disabled")

const unavailable = resolveCategory(
  "quick",
  { categories: { quick: { model: "openai/not-installed" } } },
  registry([model("anthropic", "claude-sonnet-4-6")]),
)
requireCondition(unavailable.kind === "model_unavailable", "unavailable scenario did not fail with model_unavailable")
if (unavailable.kind !== "model_unavailable") {
  throw new Error("unavailable scenario did not fail with model_unavailable")
}
requireCondition(unavailable.attemptedModel === "openai/not-installed", "unavailable attempted model mismatch")
requireCondition(
  unavailable.availableModels.includes("anthropic/claude-sonnet-4-6"),
  "unavailable available models missing registry model",
)

console.log(JSON.stringify({ happy, disabled, unavailable }, null, 2))
