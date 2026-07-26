import type { SenpiModelPort, SenpiModelRegistryPort } from "../category"

export type ParsedAgentModel = {
  readonly provider: string
  readonly modelId: string
}

const SECRET_LIKE_MODEL_FIELD_NAMES: ReadonlySet<string> = new Set([
  "accesstoken", "apikey", "auth", "authorization",
  "bearertoken", "clientsecret", "password", "privatekey",
  "privatetoken", "secret", "secretkey", "token",
] as const)

export function findExactAgentModel<TModel extends SenpiModelPort>(
  candidate: string,
  registry: SenpiModelRegistryPort<TModel>,
): ParsedAgentModel | undefined {
  const expected = parseModel(candidate)
  return expected === undefined
    ? undefined
    : parseRegistryModel(registry.find(expected.provider, expected.modelId), expected)
}

export function parseAvailableAgentModels(models: unknown): readonly string[] | undefined {
  if (!Array.isArray(models)) return undefined
  return models
    .map((model) => parseRegistryModel(model))
    .filter((model) => model !== undefined)
    .map((model) => `${model.provider}/${model.modelId}`)
    .sort()
}

// Mirrors category/resolver.ts registry parsing so agent resolution preserves the same safe boundary.
function parseRegistryModel(
  model: unknown,
  expected?: ParsedAgentModel,
): ParsedAgentModel | undefined {
  if (typeof model !== "object" || model === null || hasSecretLikeModelField(model)) return undefined
  const provider = ownStringDataProperty(model, "provider")
  const modelId = ownStringDataProperty(model, "id")
  if (!provider || !modelId) return undefined
  if (expected !== undefined && (provider !== expected.provider || modelId !== expected.modelId)) return undefined
  return { provider, modelId }
}

function parseModel(model: string): ParsedAgentModel | undefined {
  const separatorIndex = model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === model.length - 1) return undefined
  return { provider: model.slice(0, separatorIndex), modelId: model.slice(separatorIndex + 1) }
}

function hasSecretLikeModelField(model: object): boolean {
  return Object.getOwnPropertyNames(model).some((key) =>
    SECRET_LIKE_MODEL_FIELD_NAMES.has(key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase())
  )
}

function ownStringDataProperty(model: object, key: "provider" | "id"): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(model, key)
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined
}
