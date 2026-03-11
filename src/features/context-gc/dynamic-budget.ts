import type { ContextGcConfig } from "./types"

const DEFAULT_HOT_TURNS = 3
const DEFAULT_WARM_TURNS = 10
const DEFAULT_COLD_TURNS = 25
const DEFAULT_GONE_TURNS = 40
const DEFAULT_MIN_HOT_TURNS = 3

export type AdjustedBudget = {
  hot_turns: number
  warm_turns: number
  cold_turns: number
  gone_turns: number
}

type PressureZone = "low" | "normal" | "elevated" | "high" | "extreme"

function classifyPressure(contextUsageRatio: number): PressureZone {
  if (contextUsageRatio < 0.30) return "low"
  if (contextUsageRatio < 0.45) return "normal"
  if (contextUsageRatio < 0.60) return "elevated"
  if (contextUsageRatio < 0.75) return "high"
  return "extreme"
}

const PRESSURE_MULTIPLIERS: Record<PressureZone, { hot: number; warm: number; cold: number; gone: number }> = {
  low:      { hot: 1.5, warm: 1.5, cold: 1.3, gone: 1.3 },
  normal:   { hot: 1.0, warm: 1.0, cold: 1.0, gone: 1.0 },
  elevated: { hot: 1.0, warm: 0.8, cold: 0.7, gone: 0.6 },
  high:     { hot: 0.8, warm: 0.6, cold: 0.5, gone: 0.4 },
  extreme:  { hot: 0.6, warm: 0.4, cold: 0.3, gone: 0.25 },
}

export function computeDynamicBudget(
  config: ContextGcConfig | undefined,
  contextUsageRatio: number,
): AdjustedBudget {
  const baseHot = config?.hot_turns ?? DEFAULT_HOT_TURNS
  const baseWarm = config?.warm_turns ?? DEFAULT_WARM_TURNS
  const baseCold = config?.cold_turns ?? DEFAULT_COLD_TURNS
  const baseGone = config?.gone_turns ?? DEFAULT_GONE_TURNS
  const minHot = config?.min_hot_turns ?? DEFAULT_MIN_HOT_TURNS

  const ratio = Math.max(0, Math.min(1, contextUsageRatio))
  const zone = classifyPressure(ratio)
  const mult = PRESSURE_MULTIPLIERS[zone]

  const hotRaw = Math.round(baseHot * mult.hot)
  const hot = Math.max(minHot, hotRaw)

  const warmRaw = Math.round(baseWarm * mult.warm)
  const warm = Math.max(hot + 1, warmRaw)

  const coldRaw = Math.round(baseCold * mult.cold)
  const cold = Math.max(warm + 1, coldRaw)

  const goneRaw = Math.round(baseGone * mult.gone)
  const gone = Math.max(cold + 1, goneRaw)

  return {
    hot_turns: hot,
    warm_turns: warm,
    cold_turns: cold,
    gone_turns: gone,
  }
}

export function getPressureZone(contextUsageRatio: number): PressureZone {
  return classifyPressure(Math.max(0, Math.min(1, contextUsageRatio)))
}
