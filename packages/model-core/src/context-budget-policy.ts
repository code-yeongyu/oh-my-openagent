export interface ContextBudgetPolicy {
  physicalContextWindow: number
  maxActiveContextTokens: number
  keepRecentTokens: number
  warmupFraction: number
  targetActiveFraction: number
  reserveTokens: number
  emergencyHardLimitTokens: number
}

export interface ContextBudgetConfig {
  max_active_context_tokens?: number
  keep_recent_tokens?: number
  warmup_fraction?: number
  target_active_fraction?: number
  reserve_tokens?: number
}

export interface ResolveContextBudgetOptions {
  providerID: string
  modelID: string
  physicalContextWindow: number
  config?: ContextBudgetConfig
}

const DEFAULT_RESERVE_TOKENS = 16_384
const DEFAULT_1M_CEILING = 384_000
const DEFAULT_1M_KEEP_RECENT = 35_000
const DEFAULT_STANDARD_KEEP_RECENT = 20_000
const DEFAULT_WARMUP_FRACTION = 0.75
const DEFAULT_TARGET_ACTIVE_FRACTION = 0.60
const LARGE_WINDOW_THRESHOLD = 500_000

export function isLargeContextModel(physicalContextWindow: number): boolean {
  return physicalContextWindow >= LARGE_WINDOW_THRESHOLD
}

export function resolveContextBudgetPolicy(options: ResolveContextBudgetOptions): ContextBudgetPolicy {
  const { physicalContextWindow, config } = options
  const isLarge = isLargeContextModel(physicalContextWindow)
  const requestedReserveTokens = config?.reserve_tokens ?? DEFAULT_RESERVE_TOKENS
  const reserveTokens = Math.min(requestedReserveTokens, Math.max(0, physicalContextWindow - 1))

  let defaultCeiling: number
  if (isLarge) {
    defaultCeiling = DEFAULT_1M_CEILING
  } else {
    defaultCeiling = Math.max(1, physicalContextWindow - reserveTokens)
  }

  const configuredCeiling = config?.max_active_context_tokens ?? defaultCeiling
  const maxActiveContextTokens = Math.min(
    Math.max(1, physicalContextWindow - reserveTokens),
    configuredCeiling
  )

  const defaultKeepRecent = isLarge ? DEFAULT_1M_KEEP_RECENT : DEFAULT_STANDARD_KEEP_RECENT
  const keepRecentTokens = config?.keep_recent_tokens ?? defaultKeepRecent

  const warmupFraction = config?.warmup_fraction ?? DEFAULT_WARMUP_FRACTION
  const targetActiveFraction = config?.target_active_fraction ?? DEFAULT_TARGET_ACTIVE_FRACTION

  const emergencyHardLimitTokens = Math.max(0, physicalContextWindow - Math.floor(reserveTokens / 2))

  return {
    physicalContextWindow,
    maxActiveContextTokens,
    keepRecentTokens,
    warmupFraction,
    targetActiveFraction,
    reserveTokens,
    emergencyHardLimitTokens,
  }
}
