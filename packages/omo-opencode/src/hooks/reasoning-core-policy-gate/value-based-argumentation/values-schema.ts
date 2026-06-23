import type { ReasonArgueRequest } from "../reasoning-core-client"

export const VALUE_DIMENSIONS = [
  "safety",
  "autonomy",
  "cost_efficiency",
  "transparency",
  "precedent_integrity",
  "beneficence",
  "justice",
  "dignity",
  "task_completion",
] as const

export type ValueDimension = typeof VALUE_DIMENSIONS[number]
export type VafTheory = ReasonArgueRequest["theory"]

const VALUE_SET = new Set<string>(VALUE_DIMENSIONS)
const VALUE_TAG_PATTERN = /@value:([a-z_]+)/g

export function extractValueDimensions(text: string): ValueDimension[] {
  const matches = text.matchAll(VALUE_TAG_PATTERN)
  const values = new Set<ValueDimension>()

  for (const match of matches) {
    const candidate = match[1]
    if (candidate && VALUE_SET.has(candidate)) {
      values.add(candidate as ValueDimension)
    }
  }

  return [...values]
}

export function theoryContainsValueTags(theory: VafTheory): boolean {
  return extractValueDimensions(JSON.stringify(theory)).length > 0
}
