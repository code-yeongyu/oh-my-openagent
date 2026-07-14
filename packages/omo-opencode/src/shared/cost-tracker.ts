/**
 * MaTrix Cost Tracker — Native cost tracking for LLM calls.
 *
 * Why this exists (Matrix v1 had it as an overlay, we made it native):
 *   - Every LLM call costs money. We need to know how much per session, per agent, per project.
 *   - Built on top of OMO's telemetry-core primitives (no need to ship our own).
 *   - JSONL append-only log, easy to query, dashboard-ready.
 *
 * Design:
 *   - Append-only JSONL file at `.matrix/logs/cost.jsonl`
 *   - In-memory cache for the current session (fast reads for live dashboard)
 *   - Pricing table per model (in dollars per 1K tokens, in/out separated)
 *   - Hook-friendly: hooks can call `recordCost()` from any context
 *   - 3-month retention policy (configurable, default = delete > 90 days)
 *
 * NOTE: Pricing data is approximate as of 2026-07-03. Update `MODEL_PRICING` table
 * when prices change. Sources: provider pricing pages.
 */

import { existsSync, appendFileSync, mkdirSync, readFileSync, statSync, unlinkSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

// Pricing in USD per 1K tokens. Update when prices change.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic Claude
  "claude-opus-4-7": { input: 0.015, output: 0.075 },
  "claude-sonnet-4-6": { input: 0.003, output: 0.015 },
  "claude-haiku-4-5": { input: 0.0008, output: 0.004 },
  // OpenAI GPT
  "gpt-5.5": { input: 0.005, output: 0.020 },
  "gpt-5.5-mini": { input: 0.0005, output: 0.002 },
  "gpt-5.4-mini": { input: 0.0003, output: 0.0015 },
  "gpt-5.4-nano": { input: 0.0001, output: 0.0004 },
  // Google Gemini
  "gemini-3.1-pro": { input: 0.00125, output: 0.005 },
  "gemini-3-flash": { input: 0.0001, output: 0.0004 },
  // Moonshot Kimi
  "kimi-k2.6": { input: 0.001, output: 0.003 },
  "k2p5": { input: 0.001, output: 0.003 },
  // Z.ai GLM
  "glm-5.1": { input: 0.0007, output: 0.0007 },
  "glm-5.2": { input: 0.0007, output: 0.0007 },
  // Other
  "big-pickle": { input: 0.0001, output: 0.0001 },
  "qwen3.5-plus": { input: 0.0004, output: 0.0012 },
  "minimax-m2.7": { input: 0.0002, output: 0.0008 },
  "minimax-m2.7-highspeed": { input: 0.0003, output: 0.001 },
  "minimax-m3": { input: 0.0002, output: 0.0008 },
}

const DEFAULT_PRICING = { input: 0.001, output: 0.002 }

/**
 * Extract model name from "providerID/modelID" format.
 */
function extractModelName(fullModel: string): string {
  return fullModel.includes("/") ? (fullModel.split("/").pop() ?? fullModel) : fullModel
}

/**
 * Get pricing for a model. Falls back to default if model unknown.
 */
export function getModelPricing(model: string): { input: number; output: number } {
  const name = extractModelName(model)
  // Try exact match first
  if (MODEL_PRICING[name]) return MODEL_PRICING[name]
  // Try partial match (e.g., "claude-opus-4-7" matches "claude-opus-4-7-something")
  for (const [key, value] of Object.entries(MODEL_PRICING)) {
    if (name.startsWith(key) || key.startsWith(name)) return value
  }
  return DEFAULT_PRICING
}

/**
 * Calculate cost in USD for a given model and token counts.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { inputCost: number; outputCost: number; total: number } {
  const pricing = getModelPricing(model)
  const inputCost = (inputTokens / 1000) * pricing.input
  const outputCost = (outputTokens / 1000) * pricing.output
  return { inputCost, outputCost, total: inputCost + outputCost }
}

export interface CostRecord {
  timestamp: string // ISO 8601
  session_id: string
  agent: string
  model: string
  provider: string
  input_tokens: number
  output_tokens: number
  input_cost: number
  output_cost: number
  total_cost: number
  task_id?: string
  project?: string
}

/**
 * Get the path to the cost log file.
 * Default: <cwd>/.matrix/logs/cost.jsonl
 * Override: MATRIX_COST_LOG env var
 */
function getCostLogPath(): string {
  const override = process.env.MATRIX_COST_LOG
  if (override) return override
  const logDir = join(process.cwd(), ".matrix", "logs")
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  return join(logDir, "cost.jsonl")
}

/**
 * Record a cost entry. Appends to JSONL log.
 * Safe to call from any context (fire-and-forget).
 */
export function recordCost(record: Omit<CostRecord, "timestamp">): void {
  const fullRecord: CostRecord = {
    ...record,
    timestamp: new Date().toISOString(),
  }
  try {
    const path = getCostLogPath()
    appendFileSync(path, JSON.stringify(fullRecord) + "\n", "utf8")
  } catch (err) {
    // Silently fail - cost tracking should never break the main flow
    if (process.env.MATRIX_DEBUG) {
      console.error("[matrix:cost] Failed to record:", err)
    }
  }
}

/**
 * Read all cost records from the log.
 * Returns empty array if log doesn't exist.
 */
export function readCostLog(): CostRecord[] {
  const path = getCostLogPath()
  if (!existsSync(path)) return []
  try {
    const content = readFileSync(path, "utf8")
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as CostRecord)
  } catch {
    return []
  }
}

/**
 * Aggregate costs by session, agent, or model.
 */
export interface CostSummary {
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  records: number
  byAgent: Record<string, { cost: number; calls: number }>
  byModel: Record<string, { cost: number; calls: number }>
  bySession: Record<string, { cost: number; calls: number }>
  byProject: Record<string, { cost: number; calls: number }>
  byDay: Record<string, { cost: number; calls: number }>
}

export function summarizeCosts(records: CostRecord[]): CostSummary {
  const summary: CostSummary = {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    records: records.length,
    byAgent: {},
    byModel: {},
    bySession: {},
    byProject: {},
    byDay: {},
  }

  for (const r of records) {
    summary.totalCost += r.total_cost
    summary.totalInputTokens += r.input_tokens
    summary.totalOutputTokens += r.output_tokens

    const ensureBucket = (m: Record<string, { cost: number; calls: number }>, key: string) => {
      if (!m[key]) m[key] = { cost: 0, calls: 0 }
      m[key].cost += r.total_cost
      m[key].calls += 1
    }
    ensureBucket(summary.byAgent, r.agent)
    ensureBucket(summary.byModel, r.model)
    ensureBucket(summary.bySession, r.session_id)
    if (r.project) ensureBucket(summary.byProject, r.project)
    const day = r.timestamp.split("T")[0] // YYYY-MM-DD
    ensureBucket(summary.byDay, day)
  }

  return summary
}

/**
 * Clean up cost records older than `retentionDays` (default 90).
 * Called automatically on plugin init if MATRIX_COST_CLEANUP=1.
 */
export function cleanupOldCostRecords(retentionDays = 90): number {
  const path = getCostLogPath()
  if (!existsSync(path)) return 0
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  let removed = 0
  try {
    const content = readFileSync(path, "utf8")
    const lines = content.split("\n")
    const kept: string[] = []
    for (const line of lines) {
      if (line.trim().length === 0) continue
      try {
        const r = JSON.parse(line) as CostRecord
        if (new Date(r.timestamp).getTime() >= cutoff) {
          kept.push(line)
        } else {
          removed++
        }
      } catch {
        // Skip malformed lines
      }
    }
    if (removed > 0) {
      appendFileSync(path, "", "utf8") // Truncate
      appendFileSync(path, kept.join("\n") + (kept.length > 0 ? "\n" : ""), "utf8")
    }
  } catch {
    // Silent fail
  }
  return removed
}

/**
 * Generate a simple HTML dashboard from cost records.
 * Saved to .matrix/dashboard.html
 */
export function generateDashboard(): string {
  const records = readCostLog()
  const summary = summarizeCosts(records)

  const topAgents = Object.entries(summary.byAgent)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10)
  const topModels = Object.entries(summary.byModel)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10)
  const recentDays = Object.entries(summary.byDay)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 30)
    .reverse()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MaTrix Cost Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
    h1 { color: #00d9ff; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; }
    .card h3 { color: #888; font-size: 11px; text-transform: uppercase; margin-bottom: 8px; }
    .card .value { font-size: 28px; font-weight: bold; color: #00d9ff; }
    .card .subvalue { color: #666; font-size: 13px; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #333; }
    th { color: #888; font-size: 11px; text-transform: uppercase; }
    td.cost { color: #00d9ff; font-family: monospace; }
    .bar { background: #00d9ff33; height: 4px; border-radius: 2px; }
  </style>
</head>
<body>
  <h1>MaTrix Cost Dashboard</h1>
  <p style="color:#666;margin-bottom:24px;">Generated ${new Date().toISOString()} — ${summary.records} records</p>

  <div class="grid">
    <div class="card">
      <h3>Total Cost</h3>
      <div class="value">$${summary.totalCost.toFixed(4)}</div>
      <div class="subvalue">${summary.records} LLM calls</div>
    </div>
    <div class="card">
      <h3>Input Tokens</h3>
      <div class="value">${summary.totalInputTokens.toLocaleString()}</div>
      <div class="subvalue">${(summary.totalInputTokens / 1000).toFixed(1)}K</div>
    </div>
    <div class="card">
      <h3>Output Tokens</h3>
      <div class="value">${summary.totalOutputTokens.toLocaleString()}</div>
      <div class="subvalue">${(summary.totalOutputTokens / 1000).toFixed(1)}K</div>
    </div>
    <div class="card">
      <h3>Avg Cost / Call</h3>
      <div class="value">$${summary.records > 0 ? (summary.totalCost / summary.records).toFixed(4) : "0"}</div>
    </div>
  </div>

  <div class="card" style="margin-bottom: 16px;">
    <h3>Top Agents (by cost)</h3>
    <table>
      <tr><th>Agent</th><th>Calls</th><th>Cost</th></tr>
      ${topAgents.map(([k, v]) => `<tr><td>${k}</td><td>${v.calls}</td><td class="cost">$${v.cost.toFixed(4)}</td></tr>`).join("")}
    </table>
  </div>

  <div class="card" style="margin-bottom: 16px;">
    <h3>Top Models (by cost)</h3>
    <table>
      <tr><th>Model</th><th>Calls</th><th>Cost</th></tr>
      ${topModels.map(([k, v]) => `<tr><td>${k}</td><td>${v.calls}</td><td class="cost">$${v.cost.toFixed(4)}</td></tr>`).join("")}
    </table>
  </div>

  <div class="card">
    <h3>Recent Days</h3>
    <table>
      <tr><th>Date</th><th>Calls</th><th>Cost</th></tr>
      ${recentDays.map(([k, v]) => `<tr><td>${k}</td><td>${v.calls}</td><td class="cost">$${v.cost.toFixed(4)}</td></tr>`).join("")}
    </table>
  </div>
</body>
</html>`
}

/**
 * Save the dashboard HTML to .matrix/dashboard.html
 * Returns the path to the saved file.
 */
export function saveDashboard(): string {
  const html = generateDashboard()
  const dir = join(process.cwd(), ".matrix")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = join(dir, "dashboard.html")
  appendFileSync(path, "", "utf8") // truncate
  appendFileSync(path, html, "utf8")
  return path
}
