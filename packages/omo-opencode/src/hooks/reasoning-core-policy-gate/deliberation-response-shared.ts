type UnknownRecord = Record<string, unknown>

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function getResultRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  if (isRecord(value.result)) return value.result
  return value
}

export function getSolverIterations(value: unknown, fallbackIterations: number): number {
  const resultRecord = getResultRecord(value)
  const candidates = [resultRecord.iterations_used, resultRecord.iterations, resultRecord.solver_iterations]

  for (const candidate of candidates) {
    if (typeof candidate === "number") {
      return candidate
    }
  }

  return fallbackIterations
}
