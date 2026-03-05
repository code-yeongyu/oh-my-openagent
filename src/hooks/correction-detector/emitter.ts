import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

import { SYSTEM_EVENTS_PATH, SEVERITY_WEIGHTS, HOOK_NAME } from "./constants"
import type { DetectedCorrection } from "./detector"
import { highestSeverity } from "./detector"
import { log } from "../../shared/logger"

/**
 * Find the Mind Palace vault root.
 * Checks the standard iCloud path on macOS.
 */
function findVaultRoot(): string | null {
  const candidates = [
    path.join(
      os.homedir(),
      "Library/Mobile Documents/iCloud~md~obsidian/Documents/Mind Palace",
    ),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Emit a correction event to system-events.jsonl.
 *
 * The trust scorer reads these events and docks the relevant agent's trust score.
 * Event format matches the system-event-schema.md specification.
 */
export function emitCorrectionEvent(
  corrections: DetectedCorrection[],
  sessionID: string,
  agentName?: string,
): boolean {
  const vaultRoot = findVaultRoot()
  if (!vaultRoot) {
    log(`[${HOOK_NAME}] Cannot emit: Mind Palace not found`)
    return false
  }

  const eventsPath = path.join(vaultRoot, SYSTEM_EVENTS_PATH)
  const eventsDir = path.dirname(eventsPath)

  if (!fs.existsSync(eventsDir)) {
    log(`[${HOOK_NAME}] Cannot emit: events directory does not exist: ${eventsDir}`)
    return false
  }

  const severity = highestSeverity(corrections)
  if (!severity) return false

  const labels = corrections.map((c) => c.pattern.label)
  const matchedTexts = corrections.map((c) => c.matchedText)
  const weight = SEVERITY_WEIGHTS[severity] ?? 0.5

  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "")
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")
  const eventId = `evt_${dateStr}_${seq}`

  const event = {
    id: eventId,
    event_type: "correction",
    timestamp: now.toISOString(),
    content: `CK correction (${severity}): ${matchedTexts.join("; ")}`,
    domain_tags: ["governance", "trust"],
    agent_type: agentName ?? "unknown",
    session_id: sessionID,
    confidence: severity === "hard" ? 0.95 : 0.75,
    source_component: `${HOOK_NAME}:${severity}`,
    correction_meta: {
      severity,
      weight,
      labels,
      matched_texts: matchedTexts,
      agent: agentName ?? "unknown",
      session_id: sessionID,
    },
  }

  try {
    const line = JSON.stringify(event) + "\n"
    fs.appendFileSync(eventsPath, line, "utf-8")
    log(`[${HOOK_NAME}] Emitted correction event`, {
      severity,
      labels,
      agent: agentName,
      sessionID,
    })
    return true
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to write correction event`, { error: String(error) })
    return false
  }
}
