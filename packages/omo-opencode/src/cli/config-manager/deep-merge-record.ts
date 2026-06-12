export function deepMergeRecord<TTarget extends Record<string, unknown>>(
  target: TTarget,
  source: Partial<TTarget>
): TTarget {
  const result: TTarget = { ...target }

  for (const key of Object.keys(source) as Array<keyof TTarget>) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue
    const sourceValue = source[key]
    const targetValue = result[key]

    if (
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMergeRecord(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as TTarget[keyof TTarget]
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as TTarget[keyof TTarget]
    }
  }

  return result
}
