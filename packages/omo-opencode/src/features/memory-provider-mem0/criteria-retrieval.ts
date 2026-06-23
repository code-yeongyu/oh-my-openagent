export interface RetrievalCriterion {
  name: string
  description: string
  weight: number
}

export interface CriteriaRetrievalConfig {
  criteria: RetrievalCriterion[]
}

export class CriteriaRetrievalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CriteriaRetrievalError"
  }
}

const MAX_CRITERIA = 20
const MIN_WEIGHT = 0
const MAX_WEIGHT = 10

export function validateCriterion(criterion: RetrievalCriterion): void {
  if (!criterion.name || criterion.name.trim() === "") {
    throw new CriteriaRetrievalError("Criterion name is required")
  }
  if (!criterion.description || criterion.description.trim() === "") {
    throw new CriteriaRetrievalError(
      `Criterion '${criterion.name}' requires a description`,
    )
  }
  if (typeof criterion.weight !== "number" || !Number.isFinite(criterion.weight)) {
    throw new CriteriaRetrievalError(
      `Criterion '${criterion.name}' weight must be a finite number`,
    )
  }
  if (criterion.weight < MIN_WEIGHT || criterion.weight > MAX_WEIGHT) {
    throw new CriteriaRetrievalError(
      `Criterion '${criterion.name}' weight must be between ${MIN_WEIGHT} and ${MAX_WEIGHT}`,
    )
  }
}

export function validateCriteriaConfig(config: CriteriaRetrievalConfig): void {
  if (!Array.isArray(config.criteria)) {
    throw new CriteriaRetrievalError("criteria must be an array")
  }
  if (config.criteria.length === 0) {
    throw new CriteriaRetrievalError("criteria array must not be empty")
  }
  if (config.criteria.length > MAX_CRITERIA) {
    throw new CriteriaRetrievalError(
      `Too many criteria: ${config.criteria.length} exceeds max ${MAX_CRITERIA}`,
    )
  }
  const seen = new Set<string>()
  for (const criterion of config.criteria) {
    validateCriterion(criterion)
    const key = criterion.name.trim().toLowerCase()
    if (seen.has(key)) {
      throw new CriteriaRetrievalError(`Duplicate criterion name: ${criterion.name}`)
    }
    seen.add(key)
  }
}

export function buildCriteriaPayload(
  config: CriteriaRetrievalConfig,
): Array<Record<string, unknown>> {
  validateCriteriaConfig(config)
  return config.criteria.map((c) => ({
    name: c.name.trim(),
    description: c.description.trim(),
    weight: c.weight,
  }))
}

export function normalizeCriteriaWeights(
  criteria: RetrievalCriterion[],
): RetrievalCriterion[] {
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0)
  if (totalWeight === 0) {
    return criteria.map((c) => ({ ...c, weight: 1 / criteria.length }))
  }
  return criteria.map((c) => ({ ...c, weight: c.weight / totalWeight }))
}

export const CRITERIA_PRESETS: Record<string, CriteriaRetrievalConfig> = {
  technical_priority: {
    criteria: [
      { name: "technical_accuracy", description: "Prefer technically accurate and specific facts", weight: 5 },
      { name: "code_relevance", description: "Prefer memories containing code or config snippets", weight: 4 },
      { name: "recency", description: "Prefer recent technical decisions", weight: 2 },
    ],
  },
  preference_priority: {
    criteria: [
      { name: "user_preference", description: "Prefer explicit user preferences and choices", weight: 5 },
      { name: "repeated_mention", description: "Prefer patterns repeated in multiple conversations", weight: 3 },
    ],
  },
}
