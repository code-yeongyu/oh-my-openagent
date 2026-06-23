import type { SemanticsComparison } from "./extended-response-types"

const SEMANTICS = ["grounded", "preferred", "stable", "complete"] as const

export function createMultiSemanticsComparator(client: { argue: Function }) {
  return {
    async compare(theory: unknown): Promise<SemanticsComparison> {
      const results = await Promise.allSettled(
        SEMANTICS.map((semantics) => client.argue({ theory, semantics }))
      )

      const groundedExtensions = getExtensions(results[0])
      const preferredExtensions = getExtensions(results[1])
      const stableExtensions = getExtensions(results[2])
      const completeExtensions = getExtensions(results[3])

      const groundedSet = uniqueStrings(groundedExtensions.flat())
      const preferredSet = uniqueStrings(preferredExtensions.flat())
      const weakerSet = uniqueStrings([...stableExtensions.flat(), ...completeExtensions.flat()])

      return {
        grounded_set: groundedSet,
        preferred_extensions: preferredExtensions,
        stable_extensions: stableExtensions,
        complete_extensions: completeExtensions,
        certainty_gradient: {
          certain: [...groundedSet].sort(),
          defensible: difference(preferredSet, groundedSet),
          contested: difference(weakerSet, [...groundedSet, ...preferredSet]),
        },
      }
    },
  }
}

function getExtensions(result: PromiseSettledResult<unknown>): string[][] {
  if (result.status !== "fulfilled") return []
  const record = getResultRecord(result.value)
  if (!Array.isArray(record.extensions)) return []

  return record.extensions.flatMap((extension) => {
    if (!isRecord(extension) || !Array.isArray(extension.accepted_conclusions)) return []
    return [uniqueStrings(extension.accepted_conclusions.filter(isString))]
  })
}

function getResultRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  return isRecord(value.result) ? value.result : value
}

function difference(source: string[], excluded: string[]): string[] {
  const excludedSet = new Set(excluded)
  return source.filter((item) => !excludedSet.has(item)).sort()
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}
