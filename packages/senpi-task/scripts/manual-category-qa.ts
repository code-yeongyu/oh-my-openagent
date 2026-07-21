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
      value: "gpt-5.4-mini",
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
requireCondition(happy.spec.variant === "xhigh", "happy variant mismatch")
requireCondition(happy.spec.prompt_append?.includes("DEEP LOGICAL REASONING") === true, "happy prompt missing")

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

const headerModel = {
  provider: "openai",
  id: "gpt-5.4-mini",
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
  { provider: "openai", id: "gpt-5.4-mini", password: "hidden" },
  { provider: "openai", id: "gpt-5.4-mini", accessToken: "hidden" },
  { provider: "openai", id: "gpt-5.4-mini", privateToken: "hidden" },
]
const secretFind = secretFindResults.map((findResult) => resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => [model("openai", "gpt-5.4-mini")],
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
    getAvailable: () => [model("openai", "gpt-5.4-mini")],
    find: () => findResult,
  },
))
for (const result of identityFind) {
  requireCondition(result.kind === "model_unavailable", "identity find result did not return model_unavailable")
  if (result.kind !== "model_unavailable") {
    throw new Error("identity find result did not return model_unavailable")
  }
  requireCondition(result.attemptedModel === "openai/gpt-5.4-mini", "identity find attempted model changed")
  requireCondition(!JSON.stringify(result).includes("evil"), "identity find result leaked mismatched provider")
}

const throwingFindMarker = "hidden find accessor marker"
const throwingFind = resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => [model("openai", "gpt-5.4-mini")],
    find: () => throwingProviderAccessorModel(throwingFindMarker),
  },
)
requireCondition(throwingFind.kind === "model_unavailable", "throwing find accessor did not return model_unavailable")
if (throwingFind.kind !== "model_unavailable") {
  throw new Error("throwing find accessor did not return model_unavailable")
}
requireCondition(
  throwingFind.availableModels.includes("openai/gpt-5.4-mini"),
  "throwing find accessor lost valid available model",
)
requireCondition(!JSON.stringify(throwingFind).includes(throwingFindMarker), "throwing find accessor marker leaked")

const inheritedIdentityModel: object = Object.create({
  provider: "openai",
  id: "gpt-5.4-mini",
  privateToken: "hidden",
})
const inheritedIdentity = resolveCategory(
  "quick",
  {},
  {
    getAvailable: () => [model("openai", "gpt-5.4-mini")],
    find: () => inheritedIdentityModel,
  },
)
requireCondition(inheritedIdentity.kind === "model_unavailable", "inherited identity model did not return model_unavailable")
requireCondition(!JSON.stringify(inheritedIdentity).includes("hidden"), "inherited identity model leaked prototype data")

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
