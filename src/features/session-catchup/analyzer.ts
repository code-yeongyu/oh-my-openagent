/**
 * Session Catchup Analyzer
 *
 * Analyzes OpenCode session history to find messages that occurred after
 * the last planning file update. This helps agents understand what context
 * might have been missed during long sessions.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE } from "../hook-message-injector/constants"
import { log } from "../../shared/logger"

export interface UnsyncedMessage {
  /** Message ID */
  id: string
  /** Timestamp of the message */
  timestamp: number
  /** Role (user/assistant) */
  role: string
  /** Brief content preview (first 100 chars) */
  preview: string
}

export interface CatchupReport {
  /** Whether there are unsynchronized messages */
  hasUnsyncedMessages: boolean
  /** Number of messages after last planning file update */
  unsyncedCount: number
  /** List of unsynchronized messages */
  messages: UnsyncedMessage[]
  /** Last planning file update time */
  lastPlanningUpdate: number | null
  /** Path to the planning file that was checked */
  planningFilePath: string | null
}

/**
 * Get the modification time of planning files in a change directory
 */
function getPlanningFileMtime(directory: string, planPath: string): number | null {
  const planningFiles = [
    join(directory, planPath),
    join(directory, planPath.replace("tasks.md", "findings.md")),
    join(directory, planPath.replace("tasks.md", "progress.md")),
  ]

  let latestMtime = 0

  for (const file of planningFiles) {
    try {
      if (existsSync(file)) {
        const mtime = statSync(file).mtimeMs
        if (mtime > latestMtime) {
          latestMtime = mtime
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return latestMtime > 0 ? latestMtime : null
}

/**
 * Parse a message JSON file from OpenCode storage
 */
function parseMessageFile(filePath: string): { id: string; timestamp: number; role: string; content: string } | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    const data = JSON.parse(content)
    
    // OpenCode message structure
    return {
      id: data.id || filePath,
      timestamp: data.timestamp || data.createdAt || 0,
      role: data.role || "unknown",
      content: typeof data.content === "string" 
        ? data.content 
        : JSON.stringify(data.parts || data.content || ""),
    }
  } catch {
    return null
  }
}

/**
 * Get all messages from a session directory
 */
function getSessionMessages(sessionId: string): Array<{ id: string; timestamp: number; role: string; content: string }> {
  const sessionDir = join(MESSAGE_STORAGE, sessionId)
  
  if (!existsSync(sessionDir)) {
    return []
  }

  try {
    const files = readdirSync(sessionDir).filter(f => f.endsWith(".json"))
    const messages: Array<{ id: string; timestamp: number; role: string; content: string }> = []

    for (const file of files) {
      const msg = parseMessageFile(join(sessionDir, file))
      if (msg && msg.timestamp > 0) {
        messages.push(msg)
      }
    }

    // Sort by timestamp
    return messages.sort((a, b) => a.timestamp - b.timestamp)
  } catch {
    return []
  }
}

/**
 * Find the most recent session ID from MESSAGE_STORAGE
 */
function findRecentSessionId(): string | null {
  try {
    if (!existsSync(MESSAGE_STORAGE)) {
      return null
    }

    const sessions = readdirSync(MESSAGE_STORAGE)
      .filter(d => {
        const dirPath = join(MESSAGE_STORAGE, d)
        return statSync(dirPath).isDirectory()
      })
      .map(d => ({
        id: d,
        mtime: statSync(join(MESSAGE_STORAGE, d)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)

    return sessions[0]?.id ?? null
  } catch {
    return null
  }
}

/**
 * Analyze session history to find messages after last planning file update
 *
 * @param directory Project directory
 * @param planPath Path to tasks.md relative to directory (from boulder.json)
 * @param sessionId Optional session ID (auto-detects most recent if not provided)
 */
export function analyzeSessionCatchup(
  directory: string,
  planPath: string | null,
  sessionId?: string
): CatchupReport | null {
  // If no plan path, nothing to analyze
  if (!planPath) {
    log("[session-catchup] No plan path provided")
    return null
  }

  // Get or find session ID
  const targetSessionId = sessionId ?? findRecentSessionId()
  if (!targetSessionId) {
    log("[session-catchup] No session ID found")
    return null
  }

  // Get planning file mtime
  const lastPlanningUpdate = getPlanningFileMtime(directory, planPath)
  if (!lastPlanningUpdate) {
    log("[session-catchup] Could not determine planning file mtime")
    return {
      hasUnsyncedMessages: false,
      unsyncedCount: 0,
      messages: [],
      lastPlanningUpdate: null,
      planningFilePath: join(directory, planPath),
    }
  }

  // Get session messages
  const messages = getSessionMessages(targetSessionId)
  if (messages.length === 0) {
    log("[session-catchup] No messages found in session")
    return {
      hasUnsyncedMessages: false,
      unsyncedCount: 0,
      messages: [],
      lastPlanningUpdate,
      planningFilePath: join(directory, planPath),
    }
  }

  // Find messages after last planning update
  const unsyncedMessages = messages
    .filter(m => m.timestamp > lastPlanningUpdate)
    .map(m => ({
      id: m.id,
      timestamp: m.timestamp,
      role: m.role,
      preview: m.content.slice(0, 100) + (m.content.length > 100 ? "..." : ""),
    }))

  log("[session-catchup] Analysis complete", {
    sessionId: targetSessionId,
    totalMessages: messages.length,
    unsyncedCount: unsyncedMessages.length,
    lastPlanningUpdate: new Date(lastPlanningUpdate).toISOString(),
  })

  return {
    hasUnsyncedMessages: unsyncedMessages.length > 0,
    unsyncedCount: unsyncedMessages.length,
    messages: unsyncedMessages,
    lastPlanningUpdate,
    planningFilePath: join(directory, planPath),
  }
}
