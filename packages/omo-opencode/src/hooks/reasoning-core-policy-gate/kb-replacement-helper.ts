import type { ReasoningCoreClient, ReasoningCoreKbAddEntry } from "./reasoning-core-client"

export async function replaceLearnedPattern(input: {
  client: ReasoningCoreClient
  newEntry: ReasoningCoreKbAddEntry
  query: {
    content_type: "insight"
    layer: "Learned"
    keyword: string
    similarity_query: string
    tags: string[]
  }
  isDuplicate: (entry: Record<string, unknown>, newEntry: ReasoningCoreKbAddEntry) => boolean
}): Promise<void> {
  const { client, newEntry, query, isDuplicate } = input

  try {
    const existing = await client.kbQuery(query)
    const removableIds = existing.entries
      .filter(entry => isDuplicate(entry, newEntry))
      .map(entry => (typeof entry.id === "string" ? entry.id : ""))
      .filter(Boolean)

    for (const id of removableIds) {
      try {
        await client.kbRemove({ id })
      } catch {
      }
    }
  } catch {
  }

  await client.kbAdd(newEntry)
}

export function matchesExactLearnedInsight(entry: Record<string, unknown>, newEntry: ReasoningCoreKbAddEntry): boolean {
  const entryTags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : []
  if (!hasSameTags(entryTags, newEntry.tags)) return false

  const entryContent = isRecord(entry.content) ? entry.content : undefined
  const entryInsight = entryContent && isRecord(entryContent.Insight) ? entryContent.Insight : undefined
  const newInsight = isRecord(newEntry.content.Insight) ? newEntry.content.Insight : undefined
  if (!entryInsight || !newInsight) return false

  return entryInsight.problem_type === newInsight.problem_type
    && entryInsight.lesson === newInsight.lesson
    && entryInsight.example === newInsight.example
}

function hasSameTags(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return leftSorted.every((tag, index) => tag === rightSorted[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
