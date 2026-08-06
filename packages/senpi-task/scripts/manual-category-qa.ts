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

function throwingProviderAccessorModel(message: string): object {
  return Object.defineProperties({}, {
    provider: {
      enumerable: true,
      get() {
        throw new Error(message)
      },
    },
    id: {
      enumerable: true,
      value: "gpt-5.6-luna-fast",
    },
  })
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

const happy = resolveCategory("ultrabrain", {}, registry([model("openai", "gpt-5.6-sol")]))
requireCondition(happy.kind === "resolved", "happy scenario did not resolve")
if (happy.kind !== "resolved") {
  throw new Error("happy scenario did not resolve")
}
requireCondition(happy.spec.provider === "openai", "happy provider mismatch")
requireCondition(happy.spec.modelId === "gpt-5.6-sol", "happy model mismatch")
requireCondition(happy.spec.variant === "max", "happy variant mismatch")
requireCondition(happy.spec.prompt_append?.includes("DEEP LOGICAL REASONING") === true, "happy prompt missing")

const visualPrimary = resolveCategory("visual-engineering", {}, registry([model("anthropic", "claude-opus-5")]))
requireCondition(visualPrimary.kind === "resolved", "visual-engineering primary did not resolve")
if (visualPrimary.kind !== "resolved") {
  throw new Error("visual-engineering primary did not resolve")
}
requireCondition(visualPrimary.spec.modelId === "claude-opus-5", "visual-engineering primary model mismatch")
requireCondition(visualPrimary.spec.variant === "max", "visual-engineering primary variant is not max")

const quickPrimary = resolveCategory("quick", {}, registry([model("kimi-coding", "kimi-for-coding-highspeed")]))
requireCondition(quickPrimary.kind === "resolved", "quick primary did not resolve")
if (quickPrimary.kind !== "resolved") {
  throw new Error("quick primary did not resolve")
}
requireCondition(quickPrimary.spec.provider === "kimi-coding", "quick primary provider mismatch")
requireCondition(quickPrimary.spec.modelId === "kimi-for-coding-highspeed", "quick primary model mismatch")
requireCondition(quickPrimary.modelSelection.matchedFallback === false, "quick primary should be a direct hit")

const visualKimiFallback = resolveCategory("visual-engineering", {}, registry([model("kimi-coding", "k3")]))
requireCondition(visualKimiFallback.kind === "resolved", "visual-engineering kimi fallback did not resolve")
if (visualKimiFallback.kind !== "resolved") {
  throw new Error("visual-engineering kimi fallback did not resolve")
}
requireCondition(visualKimiFallback.spec.modelId === "k3", "visual-engineering kimi fallback model mismatch")
requireCondition(visualKimiFallback.spec.variant === "max", "visual-engineering kimi fallback variant is not max")

const artistryPrimary = resolveCategory("artistry", {}, registry([model("anthropic", "claude-fable-5")]))
requireCondition(artistryPrimary.kind === "resolved", "artistry primary did not resolve")
if (artistryPrimary.kind !== "resolved") {
  throw new Error("artistry primary did not resolve")
}
requireCondition(artistryPrimary.spec.modelId === "claude-fable-5", "artistry primary model mismatch")
requireCondition(artistryPrimary.spec.variant === "xhigh", "artistry primary variant is not xhigh")

const artistryKimiFallback = resolveCategory("artistry", {}, registry([model("kimi-coding", "k3")]))
requireCondition(artistryKimiFallback.kind === "resolved", "artistry kimi fallback did not resolve")
if (artistryKimiFallback.kind !== "resolved") {
  throw new Error("artistry kimi fallback did not resolve")
}
requireCondition(artistryKimiFallback.spec.modelId === "k3", "artistry kimi fallback model mismatch")
requireCondition(artistryKimiFallback.spec.variant === "max", "artistry kimi fallback variant is not max")

const artistryOpusFallback = resolveCategory("artistry", {}, registry([model("anthropic", "claude-opus-5")]))
requireCondition(artistryOpusFallback.kind === "resolved", "artistry opus fallback did not resolve")
if (artistryOpusFallback.kind !== "resolved") {
  throw new Error("artistry opus fallback did not resolve")
}
requireCondition(artistryOpusFallback.spec.modelId === "claude-opus-5", "artistry opus fallback model mismatch")
requireCondition(artistryOpusFallback.spec.variant === "xhigh", "artistry opus fallback variant is not xhigh")

const unspecifiedHighPrimary = resolveCategory("unspecified-high", {}, registry([model("kimi-coding", "k3")]))
requireCondition(unspecifiedHighPrimary.kind === "resolved", "unspecified-high primary did not resolve")
if (unspecifiedHighPrimary.kind !== "resolved") {
  throw new Error("unspecified-high primary did not resolve")
}
requireCondition(unspecifiedHighPrimary.spec.provider === "kimi-coding", "unspecified-high primary provider mismatch")
requireCondition(unspecifiedHighPrimary.spec.modelId === "k3", "unspecified-high primary model mismatch")
requireCondition(unspecifiedHighPrimary.spec.variant === "max", "unspecified-high primary variant is not max")

const deepSolRegistry = resolveCategory("deep", {}, registry([model("openai", "gpt-5.6-sol")]))
requireCondition(deepSolRegistry.kind === "resolved", "deep did not resolve on a gpt-5.6-sol registry")
if (deepSolRegistry.kind !== "resolved") {
  throw new Error("deep did not resolve on a gpt-5.6-sol registry")
}
requireCondition(deepSolRegistry.spec.modelId === "gpt-5.6-sol", "deep model mismatch")
requireCondition(deepSolRegistry.spec.variant === "medium", "deep variant is not medium")

const noSolRegistry = registry([model("kimi-coding", "k3"), model("anthropic", "claude-opus-5")])
const deepGated = resolveCategory("deep", {}, noSolRegistry)
requireCondition(deepGated.kind === "model_unavailable", "deep did not gate on a registry without gpt-5.6-sol")
if (deepGated.kind !== "model_unavailable") {
  throw new Error("deep did not gate on a registry without gpt-5.6-sol")
}
requireCondition(deepGated.attemptedModel === "openai/gpt-5.6-sol", "deep gate attempted model mismatch")
requireCondition(!deepGated.availableCategories.includes("deep"), "deep stayed listed without gpt-5.6-sol")

const disabled = resolveCategory(
  "ultrabrain",
  { categories: { ultrabrain: { disable: true } } },
  registry([model("openai", "gpt-5.6-sol")]),
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

const hardcodedFallback = resolveCategory("quick", {}, registry([model("openai", "gpt-5.6-luna-fast")]))
requireCondition(hardcodedFallback.kind === "resolved", "hardcoded fallback scenario did not resolve")
if (hardcodedFallback.kind !== "resolved") {
  throw new Error("hardcoded fallback scenario did not resolve")
}
requireCondition(hardcodedFallback.spec.provider === "openai", "hardcoded fallback provider mismatch")
requireCondition(hardcodedFallback.spec.modelId === "gpt-5.6-luna-fast", "hardcoded fallback model mismatch")
requireCondition(hardcodedFallback.spec.variant === "minimal", "hardcoded fallback variant is not minimal")
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

const headerModel = {
  provider: "quotio-openai",
  id: "gpt-5.6-luna-fast",
  name: "header model",
  headers: { "User-Agent": "test" },
}
const headerBearing = resolveCategory("quick", {}, registry([headerModel]))
requireCondition(headerBearing.kind === "resolved", "header-bearing model scenario did not resolve")
if (headerBearing.kind !== "resolved") {
  throw new Error("header-bearing model scenario did not resolve")
}
requireCondition(headerBearing.spec.model === headerModel, "header-bearing model was not preserved")

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

const throwingAvailableMarker = "hidden available accessor marker"
const throwingAvailable = resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => [throwingProviderAccessorModel(throwingAvailableMarker)],
    find: () => undefined,
  },
)
requireCondition(throwingAvailable.kind === "model_unavailable", "throwing available accessor did not return model_unavailable")
if (throwingAvailable.kind !== "model_unavailable") {
  throw new Error("throwing available accessor did not return model_unavailable")
}
requireCondition(throwingAvailable.availableModels.length === 0, "throwing available accessor leaked available models")
requireCondition(!JSON.stringify(throwingAvailable).includes(throwingAvailableMarker), "throwing available accessor marker leaked")

const secretFindResults = [
  { provider: "openai", id: "gpt-5.6-luna-fast", password: "hidden" },
  { provider: "openai", id: "gpt-5.6-luna-fast", accessToken: "hidden" },
  { provider: "openai", id: "gpt-5.6-luna-fast", privateToken: "hidden" },
]
const secretFind = secretFindResults.map((findResult) => resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => [model("openai", "gpt-5.6-luna-fast")],
    find: () => findResult,
  },
))
for (const result of secretFind) {
  requireCondition(result.kind === "model_unavailable", "secret find result did not return model_unavailable")
  requireCondition(!JSON.stringify(result).includes("hidden"), "secret find result leaked a private field")
}

const identityFindResults = [
  { provider: "", id: "", name: "empty identity" },
  { provider: "evil", id: "other", name: "mismatched identity" },
  { provider: "openai", id: "", name: "empty model id" },
]
const identityFind = identityFindResults.map((findResult) => resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => [model("openai", "gpt-5.6-luna-fast")],
    find: () => findResult,
  },
))
for (const result of identityFind) {
  requireCondition(result.kind === "model_unavailable", "identity find result did not return model_unavailable")
  if (result.kind !== "model_unavailable") {
    throw new Error("identity find result did not return model_unavailable")
  }
  requireCondition(result.attemptedModel === "openai/gpt-5.6-luna-fast", "identity find attempted model changed")
  requireCondition(!JSON.stringify(result).includes("evil"), "identity find result leaked mismatched provider")
}

const throwingFindMarker = "hidden find accessor marker"
const throwingFind = resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => [model("openai", "gpt-5.6-luna-fast")],
    find: () => throwingProviderAccessorModel(throwingFindMarker),
  },
)
requireCondition(throwingFind.kind === "model_unavailable", "throwing find accessor did not return model_unavailable")
if (throwingFind.kind !== "model_unavailable") {
  throw new Error("throwing find accessor did not return model_unavailable")
}
requireCondition(
  throwingFind.availableModels.includes("openai/gpt-5.6-luna-fast"),
  "throwing find accessor lost valid available model",
)
requireCondition(!JSON.stringify(throwingFind).includes(throwingFindMarker), "throwing find accessor marker leaked")

const inheritedIdentityModel: object = Object.create({
  provider: "openai",
  id: "gpt-5.6-luna-fast",
  privateToken: "hidden",
})
const inheritedIdentity = resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => [model("openai", "gpt-5.6-luna-fast")],
    find: () => inheritedIdentityModel,
  },
)
requireCondition(inheritedIdentity.kind === "model_unavailable", "inherited identity model did not return model_unavailable")
requireCondition(!JSON.stringify(inheritedIdentity).includes("hidden"), "inherited identity model leaked prototype data")

const nonArrayAvailable = resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => ({ 0: model("openai", "gpt-5.6-luna-fast"), length: 1 }),
    find: () => model("openai", "gpt-5.6-luna-fast"),
  },
)
requireCondition(nonArrayAvailable.kind === "model_unavailable", "non-array getAvailable did not return model_unavailable")
if (nonArrayAvailable.kind !== "model_unavailable") {
  throw new Error("non-array getAvailable did not return model_unavailable")
}
requireCondition(nonArrayAvailable.availableModels.length === 0, "non-array getAvailable leaked available models")

const prototypeName = resolveCategory("__proto__", {}, registry([model("openai", "gpt-5.6-luna-fast")]))
requireCondition(prototypeName.kind === "not_found", "prototype-shaped category did not return not_found")

console.log(JSON.stringify({
  happy,
  quickPrimary,
  visualPrimary,
  visualKimiFallback,
  artistryPrimary,
  artistryKimiFallback,
  artistryOpusFallback,
  unspecifiedHighPrimary,
  deepSolRegistry,
  deepGated,
  disabled,
  unavailable,
  hardcodedFallback,
  systemDefault,
  headerBearing,
  malformed,
  throwingAvailable,
  secretFind,
  identityFind,
  throwingFind,
  inheritedIdentity,
  nonArrayAvailable,
  prototypeName,
}, null, 2))
