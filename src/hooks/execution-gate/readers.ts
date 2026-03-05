import * as fs from "node:fs"

import { log } from "../../shared/logger"

import {
  HOOK_NAME,
  DECISION_JOURNAL_PATH,
  FLIGHT_PLAN_PATH,
  CORRECTION_INDEX_PATH,
} from "./constants"

export interface DecisionEntry {
  id: string
  timestamp: string
  standing_order_level: number
  action: string
  rationale: string
  outcome: string
  promote_candidate?: boolean
  alternatives_considered?: string[]
  related_task_id?: string
}

export interface FlightExpectation {
  id: string
  description: string
  verification: string
  priority: "must" | "should"
  status: string
  result_notes?: string
}

export interface FlightPlan {
  metadata: {
    created_at: string
    notes: string
  }
  expectations: FlightExpectation[]
}

export interface CorrectionEntry {
  id: string
  title: string
  rule: string
  severity: "high" | "medium" | "low"
  triggers: {
    contexts: string[]
  }
}

export function loadRecentDecisions(maxAge24h: boolean = true): DecisionEntry[] {
  if (!fs.existsSync(DECISION_JOURNAL_PATH)) return []

  try {
    const content = fs.readFileSync(DECISION_JOURNAL_PATH, "utf-8").trim()
    if (!content) return []

    const cutoff = maxAge24h
      ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      : ""

    const entries: DecisionEntry[] = []
    for (const line of content.split("\n")) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as DecisionEntry
        if (!cutoff || entry.timestamp >= cutoff) {
          entries.push(entry)
        }
      } catch {
        continue
      }
    }

    return entries
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to read decision journal`, { error: String(error) })
    return []
  }
}

export function loadFlightPlan(): FlightPlan | null {
  if (!fs.existsSync(FLIGHT_PLAN_PATH)) return null

  try {
    const content = fs.readFileSync(FLIGHT_PLAN_PATH, "utf-8")
    const plan = JSON.parse(content) as FlightPlan
    if (!plan.expectations || plan.expectations.length === 0) return null
    return plan
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to read flight plan`, { error: String(error) })
    return null
  }
}

export function loadSessionStartCorrections(): CorrectionEntry[] {
  if (!fs.existsSync(CORRECTION_INDEX_PATH)) return []

  try {
    const content = fs.readFileSync(CORRECTION_INDEX_PATH, "utf-8")
    const index = JSON.parse(content) as { corrections: CorrectionEntry[] }
    const corrections = index.corrections ?? []

    return corrections.filter((c) => {
      const contexts = c.triggers?.contexts ?? []
      return contexts.includes("session_start") && c.severity === "high"
    })
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to read correction index`, { error: String(error) })
    return []
  }
}
