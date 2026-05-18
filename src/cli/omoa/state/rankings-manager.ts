import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { getOpenCodeConfigDir } from "../../../shared/opencode-config-dir"
import { parseJsonc } from "../../../shared/jsonc-parser"
import { OmoaRankingsSchema, DEFAULT_OMOA_RANKINGS, type OmoaRankings, type ModelRankingEntry } from "./omoa-rankings-schema"

const OMOA_RANKINGS_FILENAME = "omoa-rankings.json"

function getRankingsPath(): string {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  return join(configDir, OMOA_RANKINGS_FILENAME)
}

export function readOmoaRankings(): OmoaRankings {
  const path = getRankingsPath()
  if (!existsSync(path)) return { ...DEFAULT_OMOA_RANKINGS }
  try {
    const content = readFileSync(path, "utf-8")
    const raw = parseJsonc<unknown>(content)
    const parsed = OmoaRankingsSchema.safeParse(raw)
    if (parsed.success) return parsed.data
    return { ...DEFAULT_OMOA_RANKINGS }
  } catch {
    return { ...DEFAULT_OMOA_RANKINGS }
  }
}

export function writeOmoaRankings(rankings: OmoaRankings): void {
  const path = getRankingsPath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(rankings, null, 2) + "\n", "utf-8")
}

export function getAgentRankings(rankings: OmoaRankings, agent: string): ModelRankingEntry[] {
  return rankings.agents[agent] ?? []
}

export function getCategoryRankings(rankings: OmoaRankings, category: string): ModelRankingEntry[] {
  return rankings.categories[category] ?? []
}

export function hasAgentRanking(rankings: OmoaRankings, agent: string): boolean {
  return (rankings.agents[agent]?.length ?? 0) > 0
}

export function hasCategoryRanking(rankings: OmoaRankings, category: string): boolean {
  return (rankings.categories[category]?.length ?? 0) > 0
}

export function setAgentRankings(rankings: OmoaRankings, agent: string, entries: ModelRankingEntry[]): OmoaRankings {
  return { ...rankings, agents: { ...rankings.agents, [agent]: entries } }
}

export function setCategoryRankings(rankings: OmoaRankings, category: string, entries: ModelRankingEntry[]): OmoaRankings {
  return { ...rankings, categories: { ...rankings.categories, [category]: entries } }
}
