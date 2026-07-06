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

const hardcodedFallback = resolveCategory("quick", {}, registry([model("anthropic", "claude-haiku-4-5")]))
requireCondition(hardcodedFallback.kind === "resolved", "hardcoded fallback scenario did not resolve")
if (hardcodedFallback.kind !== "resolved") {
  throw new Error("hardcoded fallback scenario did not resolve")
}
requireCondition(hardcodedFallback.spec.provider === "anthropic", "hardcoded fallback provider mismatch")
requireCondition(hardcodedFallback.spec.modelId === "claude-haiku-4-5", "hardcoded fallback model mismatch")
requireCondition(hardcodedFallback.modelSelection.matchedFallback, "hardcoded fallback was not marked as fallback")

const systemDefault = resolveCategory(
  "quick",
  {},
  registry([model("local", "system-default")]),
  { systemDefaultModel: "local/system-default" },
)
requireCondition(systemDefault.kind === "resolved", "system default scenario did not resolve")
if (systemDefault.kind !== "resolved") {
  throw new Error("system default scenario did not resolve")
}
requireCondition(systemDefault.spec.provider === "local", "system default provider mismatch")
requireCondition(systemDefault.spec.modelId === "system-default", "system default model mismatch")

const malformed = resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => [null],
    find: () => undefined,
  },
)
requireCondition(malformed.kind === "model_unavailable", "malformed registry did not return model_unavailable")
if (malformed.kind !== "model_unavailable") {
  throw new Error("malformed registry did not return model_unavailable")
}
requireCondition(malformed.availableModels.length === 0, "malformed registry leaked invalid available models")

const malformedFind = resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => [model("openai", "gpt-5.4-mini")],
    find: () => ({ provider: "openai", id: "gpt-5.4-mini", privateToken: "hidden" }),
  },
)
requireCondition(malformedFind.kind === "model_unavailable", "malformed find result did not return model_unavailable")
requireCondition(!JSON.stringify(malformedFind).includes("hidden"), "malformed find result leaked a private field")

const nonArrayAvailable = resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => ({ 0: model("openai", "gpt-5.4-mini"), length: 1 }),
    find: () => model("openai", "gpt-5.4-mini"),
  },
)
requireCondition(nonArrayAvailable.kind === "model_unavailable", "non-array getAvailable did not return model_unavailable")
if (nonArrayAvailable.kind !== "model_unavailable") {
  throw new Error("non-array getAvailable did not return model_unavailable")
}
requireCondition(nonArrayAvailable.availableModels.length === 0, "non-array getAvailable leaked available models")

const prototypeName = resolveCategory("__proto__", {}, registry([model("openai", "gpt-5.4-mini")]))
requireCondition(prototypeName.kind === "not_found", "prototype-shaped category did not return not_found")

console.log(JSON.stringify({
  happy,
  disabled,
  unavailable,
  hardcodedFallback,
  systemDefault,
  malformed,
  malformedFind,
  nonArrayAvailable,
  prototypeName,
}, null, 2))
