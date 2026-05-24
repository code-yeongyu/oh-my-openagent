import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

interface TokenUsageRecord {
  sessionId: string
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  timestamp: number
}

interface TokenUsageSummary {
  sessionId: string
  models: Record<string, {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cost: number
    callCount: number
  }>
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCost: number
}

const DB_DIR = join(tmpdir(), "oh-my-opencode", "token-usage")
const SUMMARY_FILE = join(DB_DIR, "session-summaries.jsonl")

function ensureDir(): void {
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true })
}

export function recordTokenUsage(
  sessionId: string,
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  cost: number,
): void {
  ensureDir()
  const record: TokenUsageRecord = {
    sessionId,
    model,
    provider,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost,
    timestamp: Date.now(),
  }
  writeFileSync(SUMMARY_FILE, JSON.stringify(record) + "\n", { flag: "a" })
}

export function getSessionTokenUsage(sessionId: string): TokenUsageSummary | null {
  if (!existsSync(SUMMARY_FILE)) return null
  const content = readFileSync(SUMMARY_FILE, "utf-8")
  const lines = content.trim().split("\n").filter(Boolean)
  const sessionRecords: TokenUsageRecord[] = []

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as TokenUsageRecord
      if (record.sessionId === sessionId) sessionRecords.push(record)
    } catch { continue }
  }

  if (sessionRecords.length === 0) return null

  const models: TokenUsageSummary["models"] = {}
  let totalInput = 0, totalOutput = 0, totalCost = 0

  for (const r of sessionRecords) {
    if (!models[r.model]) {
      models[r.model] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, callCount: 0 }
    }
    models[r.model].inputTokens += r.inputTokens
    models[r.model].outputTokens += r.outputTokens
    models[r.model].totalTokens += r.totalTokens
    models[r.model].cost += r.cost
    models[r.model].callCount++
    totalInput += r.inputTokens
    totalOutput += r.outputTokens
    totalCost += r.cost
  }

  return {
    sessionId,
    models,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalTokens: totalInput + totalOutput,
    totalCost,
  }
}

export function getAllSessionsTokenUsage(): TokenUsageSummary[] {
  if (!existsSync(SUMMARY_FILE)) return []
  const content = readFileSync(SUMMARY_FILE, "utf-8")
  const lines = content.trim().split("\n").filter(Boolean)
  const sessionMap = new Map<string, TokenUsageRecord[]>()

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as TokenUsageRecord
      const records = sessionMap.get(record.sessionId) || []
      records.push(record)
      sessionMap.set(record.sessionId, records)
    } catch { continue }
  }

  const result: TokenUsageSummary[] = []
  for (const [sessionId, records] of sessionMap) {
    // rebuild summary from cached pattern
    const usage = getSessionTokenUsage(sessionId)
    if (usage) result.push(usage)
  }
  return result
}
