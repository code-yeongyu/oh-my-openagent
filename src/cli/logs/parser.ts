import type { LogEntry, LogLevel } from "./types"
import { ERROR_KEYWORDS, WARN_KEYWORDS } from "./constants"

/**
 * Regex to parse log line format: [ISO-TIMESTAMP] message {json}
 * Example: [2025-12-31T11:16:46.279Z] [component] message {"data": "value"}
 */
const LOG_LINE_REGEX = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]\s+(.+)$/

/**
 * Regex to extract source component from message: [component-name] rest of message
 */
const SOURCE_REGEX = /^\[([^\]]+)\]\s*(.*)$/

/**
 * Detect log level based on message content
 */
export function detectLevel(message: string): LogLevel {
  const lowerMessage = message.toLowerCase()

  for (const keyword of ERROR_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return "error"
    }
  }

  for (const keyword of WARN_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return "warn"
    }
  }

  return "info"
}

/**
 * Extract source component and clean message
 */
export function extractSource(message: string): {
  source: string | undefined
  cleanMessage: string
} {
  const match = message.match(SOURCE_REGEX)
  if (match) {
    return {
      source: match[1],
      cleanMessage: match[2],
    }
  }
  return {
    source: undefined,
    cleanMessage: message,
  }
}

/**
 * Try to parse JSON data from the end of a message
 */
export function extractJsonData(message: string): {
  message: string
  data: unknown | undefined
} {
  // Look for JSON object at the end of the message
  const jsonMatch = message.match(/\s+(\{[\s\S]*\})\s*$/)
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1])
      const cleanMessage = message.slice(0, message.lastIndexOf(jsonMatch[1])).trim()
      return { message: cleanMessage, data }
    } catch {
      // Not valid JSON, return original message
    }
  }
  return { message, data: undefined }
}

/**
 * Parse a single log line into a LogEntry
 */
export function parseLogLine(line: string): LogEntry | null {
  const trimmedLine = line.trim()
  if (!trimmedLine) {
    return null
  }

  const match = trimmedLine.match(LOG_LINE_REGEX)
  if (!match) {
    return null
  }

  const [, timestampStr, rawMessage] = match
  const timestamp = new Date(timestampStr)

  // Extract source component
  const { source, cleanMessage } = extractSource(rawMessage)

  // Extract JSON data
  const { message, data } = extractJsonData(cleanMessage)

  // Detect level
  const level = detectLevel(message)

  return {
    timestamp,
    message,
    data,
    source,
    level,
  }
}

/**
 * Parse entire log file content into LogEntry array
 */
export function parseLogFile(content: string): LogEntry[] {
  const lines = content.split("\n")
  const entries: LogEntry[] = []

  for (const line of lines) {
    const entry = parseLogLine(line)
    if (entry) {
      entries.push(entry)
    }
  }

  return entries
}

/**
 * Filter entries by log level
 */
export function filterByLevel(entries: LogEntry[], level: LogLevel): LogEntry[] {
  if (level === "all") {
    return entries
  }

  const levelPriority: Record<LogLevel, number> = {
    all: 0,
    info: 1,
    warn: 2,
    error: 3,
  }

  const minPriority = levelPriority[level]
  return entries.filter((entry) => levelPriority[entry.level] >= minPriority)
}

/**
 * Get the last N entries from an array
 */
export function getLastNEntries(entries: LogEntry[], n: number): LogEntry[] {
  if (n <= 0 || entries.length === 0) {
    return []
  }
  return entries.slice(-n)
}
