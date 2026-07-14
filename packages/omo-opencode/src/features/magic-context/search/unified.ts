import type { SearchResult } from "./types"

export interface MergeOptions {
  limit?: number
  threshold?: number
  diversify?: boolean
}

export function mergeResults(
  sourceResults: SearchResult[][],
  options: MergeOptions = {},
): SearchResult[] {
  const limit = options.limit ?? 10
  const threshold = options.threshold ?? 0
  const diversify = options.diversify ?? false

  const all = sourceResults.flat()

  if (all.length === 0) return []

  const bySource = groupBySource(all)

  normalizeScoresPerSource(bySource)

  let candidates = all.filter((r) => r.score >= threshold)

  if (diversify) {
    candidates = diversifyResults(bySource, candidates, limit)
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function groupBySource(results: SearchResult[]): Map<string, SearchResult[]> {
  const map = new Map<string, SearchResult[]>()
  for (const r of results) {
    const list = map.get(r.source)
    if (list) {
      list.push(r)
    } else {
      map.set(r.source, [r])
    }
  }
  return map
}

function normalizeScoresPerSource(bySource: Map<string, SearchResult[]>): void {
  for (const list of bySource.values()) {
    if (list.length <= 1) {
      if (list.length === 1) list[0].score = 1
      continue
    }

    let min = Infinity
    let max = -Infinity
    for (const r of list) {
      if (r.score < min) min = r.score
      if (r.score > max) max = r.score
    }

    const range = max - min
    if (range === 0) {
      for (const r of list) r.score = 1
    } else {
      for (const r of list) {
        r.score = (r.score - min) / range
      }
    }
  }
}

function diversifyResults(
  bySource: Map<string, SearchResult[]>,
  candidates: SearchResult[],
  limit: number,
): SearchResult[] {
  const sorted = new Map<string, SearchResult[]>()
  for (const [source, list] of bySource.entries()) {
    sorted.set(
      source,
      [...list].sort((a, b) => b.score - a.score),
    )
  }

  const selected: SearchResult[] = []
  const sourceKeys = [...sorted.keys()]
  const indices = new Map<string, number>()
  for (const key of sourceKeys) indices.set(key, 0)

  const candidateSet = new Set(candidates)

  while (selected.length < limit) {
    let picked = false

    for (const source of sourceKeys) {
      if (selected.length >= limit) break

      const list = sorted.get(source)!
      const idx = indices.get(source)!
      if (idx >= list.length) continue

      const candidate = list[idx]
      indices.set(source, idx + 1)

      if (!candidateSet.has(candidate)) continue

      selected.push(candidate)
      picked = true
    }

    if (!picked) break
  }

  return selected
}
