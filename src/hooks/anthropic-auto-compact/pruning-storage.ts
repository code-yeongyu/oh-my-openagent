import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PruningState } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { log } from "../../shared/logger"
import { MESSAGE_STORAGE } from "../../features/hook-message-injector"

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

interface ToolPart {
  type: string
  callID?: string
  tool?: string
  state?: {
    input?: unknown
    output?: string
    status?: string
  }
}

interface MessageData {
  parts?: ToolPart[]
  [key: string]: unknown
}

export async function applyPruning(
  sessionID: string,
  state: PruningState
): Promise<number> {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) {
    log("[pruning-storage] message dir not found", { sessionID })
    return 0
  }

  let totalTokensSaved = 0
  let filesModified = 0

  try {
    const files = readdirSync(messageDir).filter(f => f.endsWith(".json"))
    
    for (const file of files) {
      const filePath = join(messageDir, file)
      const content = readFileSync(filePath, "utf-8")
      const data: MessageData = JSON.parse(content)
      
      if (!data.parts) continue
      
      let modified = false
      
      for (const part of data.parts) {
        if (part.type !== "tool" || !part.callID) continue
        
        if (!state.toolIdsToPrune.has(part.callID)) continue
        
        if (part.state?.input) {
          const inputStr = JSON.stringify(part.state.input)
          totalTokensSaved += estimateTokens(inputStr)
          part.state.input = { __pruned: true, reason: "DCP" }
          modified = true
        }
        
        if (part.state?.output) {
          totalTokensSaved += estimateTokens(part.state.output)
          part.state.output = "[Content pruned by Dynamic Context Pruning]"
          modified = true
        }
      }
      
      if (modified) {
        writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
        filesModified++
      }
    }
  } catch (error) {
    log("[pruning-storage] error applying pruning", {
      sessionID,
      error: String(error),
    })
  }

  log("[pruning-storage] applied pruning", {
    sessionID,
    filesModified,
    totalTokensSaved,
  })

  return totalTokensSaved
}
