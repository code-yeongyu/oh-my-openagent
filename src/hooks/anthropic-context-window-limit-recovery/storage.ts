import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"

const OPENCODE_STORAGE = getOpenCodeStorageDir()
const MESSAGE_STORAGE = join(OPENCODE_STORAGE, "message")
const PART_STORAGE = join(OPENCODE_STORAGE, "part")

const TRUNCATION_MESSAGE =
  "[TOOL RESULT TRUNCATED - Context limit exceeded. Original output was too large and has been truncated to recover the session. Please re-run this tool if you need the full output.]"

interface StoredToolPart {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: {
    status: "pending" | "running" | "completed" | "error"
    input: Record<string, unknown>
    output?: string
    error?: string
    time?: {
      start: number
      end?: number
      compacted?: number
    }
  }
  truncated?: boolean
  originalSize?: number
}

export interface ToolResultInfo {
  partPath: string
  partId: string
  messageID: string
  toolName: string
  outputSize: number
}

function getMessageDir(sessionID: string): string {
  if (!existsSync(MESSAGE_STORAGE)) return ""

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) {
    return directPath
  }

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) {
      return sessionPath
    }
  }

  return ""
}

function getMessageIds(sessionID: string): string[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir || !existsSync(messageDir)) return []

  const messageIds: string[] = []
  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) continue
    const messageId = file.replace(".json", "")
    messageIds.push(messageId)
  }

  return messageIds
}

export function findToolResultsBySize(sessionID: string): ToolResultInfo[] {
  const messageIds = getMessageIds(sessionID)
  const results: ToolResultInfo[] = []

  for (const messageID of messageIds) {
    const partDir = join(PART_STORAGE, messageID)
    if (!existsSync(partDir)) continue

    for (const file of readdirSync(partDir)) {
      if (!file.endsWith(".json")) continue
      try {
        const partPath = join(partDir, file)
        const content = readFileSync(partPath, "utf-8")
        const part = JSON.parse(content) as StoredToolPart

        if (part.type === "tool" && part.state?.output && !part.truncated) {
          results.push({
            partPath,
            partId: part.id,
            messageID,
            toolName: part.tool,
            outputSize: part.state.output.length,
          })
        }
      } catch {
        continue
      }
    }
  }

  return results.sort((a, b) => b.outputSize - a.outputSize)
}

export function findLargestToolResult(sessionID: string): ToolResultInfo | null {
  const results = findToolResultsBySize(sessionID)
  return results.length > 0 ? results[0] : null
}

export function truncateToolResult(partPath: string): {
  success: boolean
  toolName?: string
  originalSize?: number
} {
  try {
    const content = readFileSync(partPath, "utf-8")
    const part = JSON.parse(content) as StoredToolPart

    if (!part.state?.output) {
      return { success: false }
    }

    const originalSize = part.state.output.length
    const toolName = part.tool

    part.truncated = true
    part.originalSize = originalSize
    part.state.output = TRUNCATION_MESSAGE

    if (!part.state.time) {
      part.state.time = { start: Date.now() }
    }
    part.state.time.compacted = Date.now()

    writeFileSync(partPath, JSON.stringify(part, null, 2))

    return { success: true, toolName, originalSize }
  } catch {
    return { success: false }
  }
}

export function getTotalToolOutputSize(sessionID: string): number {
  const results = findToolResultsBySize(sessionID)
  return results.reduce((sum, r) => sum + r.outputSize, 0)
}

export function countTruncatedResults(sessionID: string): number {
  const messageIds = getMessageIds(sessionID)
  let count = 0

  for (const messageID of messageIds) {
    const partDir = join(PART_STORAGE, messageID)
    if (!existsSync(partDir)) continue

    for (const file of readdirSync(partDir)) {
      if (!file.endsWith(".json")) continue
      try {
        const content = readFileSync(join(partDir, file), "utf-8")
        const part = JSON.parse(content)
        if (part.truncated === true) {
          count++
        }
      } catch {
        continue
      }
    }
  }

  return count
}

export interface AggressiveTruncateResult {
  success: boolean
  sufficient: boolean
  truncatedCount: number
  totalBytesRemoved: number
  targetBytesToRemove: number
  truncatedTools: Array<{ toolName: string; originalSize: number }>
}

export function truncateUntilTargetTokens(
  sessionID: string,
  currentTokens: number,
  maxTokens: number,
  targetRatio: number = 0.8,
  charsPerToken: number = 4
): AggressiveTruncateResult {
  const targetTokens = Math.floor(maxTokens * targetRatio)
  const tokensToReduce = currentTokens - targetTokens
  const charsToReduce = tokensToReduce * charsPerToken

  if (tokensToReduce <= 0) {
    return {
      success: true,
      sufficient: true,
      truncatedCount: 0,
      totalBytesRemoved: 0,
      targetBytesToRemove: 0,
      truncatedTools: [],
    }
  }

  const results = findToolResultsBySize(sessionID)

  if (results.length === 0) {
    return {
      success: false,
      sufficient: false,
      truncatedCount: 0,
      totalBytesRemoved: 0,
      targetBytesToRemove: charsToReduce,
      truncatedTools: [],
    }
  }

  let totalRemoved = 0
  let truncatedCount = 0
  const truncatedTools: Array<{ toolName: string; originalSize: number }> = []

  for (const result of results) {
    const truncateResult = truncateToolResult(result.partPath)
    if (truncateResult.success) {
      truncatedCount++
      const removedSize = truncateResult.originalSize ?? result.outputSize
      totalRemoved += removedSize
      truncatedTools.push({
        toolName: truncateResult.toolName ?? result.toolName,
        originalSize: removedSize,
      })
      
      if (totalRemoved >= charsToReduce) {
        break
      }
    }
  }

  const sufficient = totalRemoved >= charsToReduce

  return {
    success: truncatedCount > 0,
    sufficient,
    truncatedCount,
    totalBytesRemoved: totalRemoved,
    targetBytesToRemove: charsToReduce,
    truncatedTools,
  }
}
