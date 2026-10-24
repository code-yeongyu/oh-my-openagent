export type TaskConcurrencyConfig = {
  readonly default_concurrency?: number
  readonly provider_concurrency?: Readonly<Record<string, number>>
  readonly model_concurrency?: Readonly<Record<string, number>>
  readonly global_concurrency?: number
}

const DEFAULT_LIMIT = 5

export function getTaskLimit(config: TaskConcurrencyConfig, model: string): number {
  const modelLimit = ownNumber(config.model_concurrency, model)
  if (modelLimit !== undefined) return modelLimit === 0 ? Number.POSITIVE_INFINITY : modelLimit
  const providerLimit = ownNumber(config.provider_concurrency, providerOf(model)) ?? (providerOf(model) === "opengateway" ? 0 : undefined)
  if (providerLimit !== undefined) return providerLimit === 0 ? Number.POSITIVE_INFINITY : providerLimit
  const defaultLimit = config.default_concurrency
  if (defaultLimit !== undefined) return defaultLimit === 0 ? Number.POSITIVE_INFINITY : defaultLimit
  return DEFAULT_LIMIT
}

export function getTaskLaneKey(config: TaskConcurrencyConfig, model: string): string {
  if (ownNumber(config.model_concurrency, model) !== undefined) return model
  const provider = providerOf(model)
  if (ownNumber(config.provider_concurrency, provider) !== undefined) return provider
  return model
}

function providerOf(model: string): string {
  return model.split("/")[0] ?? model
}

function ownNumber(record: Readonly<Record<string, number>> | undefined, key: string): number | undefined {
  if (record === undefined || !Object.hasOwn(record, key)) return undefined
  return record[key]
}
