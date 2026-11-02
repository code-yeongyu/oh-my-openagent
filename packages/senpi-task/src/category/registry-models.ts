import type { SenpiModelPort } from "./types"

export type ParsedModel = {
  readonly provider: string
  readonly modelId: string
}

export type ParsedRegistryModel<TModel extends SenpiModelPort> = ParsedModel & {
  readonly model: TModel
  readonly displayName?: string
}

type AvailableModelsParseResult = {
  readonly models: readonly string[]
  readonly validContainer: boolean
}

const SECRET_LIKE_MODEL_FIELD_NAMES: ReadonlySet<string> = new Set([
  "accesstoken", "apikey", "auth", "authorization",
  "bearertoken", "clientsecret", "password", "privatekey",
  "privatetoken", "secret", "secretkey", "token",
] as const)


export function formatModel(model: ParsedModel): string {
  return `${model.provider}/${model.modelId}`
}

function normalizeModelFieldName(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase()
}

function hasSecretLikeModelField(model: object): boolean {
  return Object.getOwnPropertyNames(model).some((key) =>
    SECRET_LIKE_MODEL_FIELD_NAMES.has(normalizeModelFieldName(key))
  )
}

function ownStringDataProperty(model: object, key: "provider" | "id" | "name"): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(model, key)
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined
}

function isSenpiModelPort<TModel extends SenpiModelPort>(model: unknown): model is TModel {
  if (typeof model !== "object" || model === null || hasSecretLikeModelField(model)) return false
  return ownStringDataProperty(model, "provider") !== undefined && ownStringDataProperty(model, "id") !== undefined
}

export function parseRegistryModel<TModel extends SenpiModelPort>(
  model: unknown,
  expected?: ParsedModel,
): ParsedRegistryModel<TModel> | undefined {
  if (!isSenpiModelPort<TModel>(model)) {
    return undefined
  }
  const provider = ownStringDataProperty(model, "provider")
  const modelId = ownStringDataProperty(model, "id")
  const displayName = ownStringDataProperty(model, "name")
  if (!provider || !modelId || (expected !== undefined && (provider !== expected.provider || modelId !== expected.modelId))) {
    return undefined
  }
  return { model, provider, modelId, ...(displayName !== undefined && displayName.trim().length > 0 && displayName.length <= 120 && !/[\u0000-\u001f\u007f-\u009f]/u.test(displayName) ? { displayName } : {}) }
}

export function parseModel(model: string): ParsedModel | undefined {
  const separatorIndex = model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === model.length - 1) {
    return undefined
  }
  return {
    provider: model.slice(0, separatorIndex),
    modelId: model.slice(separatorIndex + 1),
  }
}

export function parseAvailableModels(models: unknown): AvailableModelsParseResult {
  if (!Array.isArray(models)) {
    return { models: [], validContainer: false }
  }
  return { models: models.map((model) => parseRegistryModel(model)).filter((model) => model !== undefined).map(formatModel).sort(), validContainer: true }
}
