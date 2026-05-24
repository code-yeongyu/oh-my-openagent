import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "../../shared/logger"

export type DeviationSeverity = "leve" | "media" | "grave"
export type GateAction = "continue" | "warn" | "block"

export interface ModeratorRecord {
  timestamp: string
  tool: string
  callID: string
  sessionID: string
  deviationCount: number
  severity: DeviationSeverity
  action: GateAction
  categories: string[]
  filePath?: string
  detail?: string
}

const RECORDS_DIR = ".omo"
const RECORDS_FILE = "moderator-decisions.jsonl"
const MAX_RECORDS = 1000

function getRecordsPath(projectDir?: string): string | undefined {
  const dir = projectDir ?? process.env.OMO_WORKSPACE_ROOT ?? process.cwd()
  if (!dir) return undefined

  const recordsDir = join(dir, RECORDS_DIR)
  if (!existsSync(recordsDir)) {
    try {
      mkdirSync(recordsDir, { recursive: true })
    } catch {
      return undefined
    }
  }

  return join(recordsDir, RECORDS_FILE)
}

export async function recordDecision(record: ModeratorRecord): Promise<void> {
  const filePath = getRecordsPath()
  if (!filePath) {
    log("[moderator-gate] Could not determine records path", { record })
    return
  }

  try {
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8")

    // Trim records if too many
    const allRecords = readAllRecords()
    if (allRecords.length > MAX_RECORDS) {
      const trimmed = allRecords.slice(allRecords.length - MAX_RECORDS)
      writeFileSync(filePath, trimmed.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8")
    }
  } catch (err) {
    log("[moderator-gate] Failed to save decision record", { error: err })
  }
}

export function readAllRecords(projectDir?: string): ModeratorRecord[] {
  const filePath = getRecordsPath(projectDir)
  if (!filePath || !existsSync(filePath)) return []

  try {
    const content = readFileSync(filePath, "utf-8")
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as ModeratorRecord
        } catch {
          return null
        }
      })
      .filter((r): r is ModeratorRecord => r !== null)
  } catch {
    return []
  }
}

export function getRecentDecisions(count = 10): ModeratorRecord[] {
  const all = readAllRecords()
  return all.slice(-count).reverse()
}

export function getWarningsCount(): number {
  const all = readAllRecords()
  return all.filter((r) => r.severity === "grave" || r.severity === "media").length
}
