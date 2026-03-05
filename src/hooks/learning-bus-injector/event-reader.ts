import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

import { log } from "../../shared/logger"

import {
  HOOK_NAME,
  RECENCY_DAYS,
  MIN_CONFIDENCE,
  MAX_EVENTS_TO_INJECT,
  EVENT_TYPE_WEIGHTS,
} from "./constants"

export interface SystemEvent {
  id: string
  timestamp: string
  session_id: string
  agent_type: string
  event_type: string
  domain_tags: string[]
  content: string
  confidence?: number
  source_component?: string
  related_events?: string[]
  propagation_targets?: string[]
}

const SYSTEM_EVENTS_PATH = join(
  homedir(),
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/Mind Palace/AI/_state/system-events.jsonl",
)

function recencyScore(timestamp: string): number {
  const eventDate = new Date(timestamp)
  const now = new Date()
  const daysDiff = Math.floor((now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24))
  if (daysDiff >= RECENCY_DAYS) return 0
  return 1.0 - (daysDiff * 0.1)
}

function computeScore(event: SystemEvent): number {
  const typeWeight = EVENT_TYPE_WEIGHTS[event.event_type] ?? 0.3
  const confidence = event.confidence ?? 0.8
  const recency = recencyScore(event.timestamp)
  return typeWeight * confidence * recency
}

export function loadAndRankEvents(): SystemEvent[] {
  if (!existsSync(SYSTEM_EVENTS_PATH)) return []

  try {
    const content = readFileSync(SYSTEM_EVENTS_PATH, "utf-8").trim()
    if (!content) return []

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - RECENCY_DAYS)
    const cutoffStr = cutoff.toISOString()

    const events: SystemEvent[] = []
    for (const line of content.split("\n")) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as SystemEvent
        if (event.timestamp >= cutoffStr) {
          const confidence = event.confidence ?? 0.8
          if (confidence >= MIN_CONFIDENCE) {
            events.push(event)
          }
        }
      } catch {
        continue
      }
    }

    if (events.length === 0) return []

    const ranked = events.sort((a, b) => computeScore(b) - computeScore(a))
    return ranked.slice(0, MAX_EVENTS_TO_INJECT)
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to read event store`, { error: String(error) })
    return []
  }
}
