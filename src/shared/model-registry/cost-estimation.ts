import { MODEL_REGISTRY } from "./registry"

export type CostLabel = "free" | "very-cheap" | "cheap" | "moderate" | "expensive" | "very-expensive"

export interface CostEstimate {
  model: string
  inputPer1MTokens: number
  outputPer1MTokens: number
  label: CostLabel
}

function assignCostLabel(inputCost: number): CostLabel {
  if (inputCost === 0) return "free"
  if (inputCost < 0.5) return "very-cheap"
  if (inputCost < 2) return "cheap"
  if (inputCost < 10) return "moderate"
  if (inputCost < 30) return "expensive"
  return "very-expensive"
}

export function estimateModelCost(modelName: string): CostEstimate | undefined {
  const entry = MODEL_REGISTRY[modelName]
  if (!entry) return undefined

  const inputCost = entry.costPer1MInputTokens ?? 0
  const outputCost = entry.costPer1MOutputTokens ?? 0
  const label = assignCostLabel(inputCost)

  return {
    model: modelName,
    inputPer1MTokens: inputCost,
    outputPer1MTokens: outputCost,
    label,
  }
}

export function compareModelCosts(models: string[]): CostEstimate[] {
  const estimates = models
    .map(model => estimateModelCost(model))
    .filter((estimate): estimate is CostEstimate => estimate !== undefined)

  return estimates.sort((a, b) => a.inputPer1MTokens - b.inputPer1MTokens)
}
