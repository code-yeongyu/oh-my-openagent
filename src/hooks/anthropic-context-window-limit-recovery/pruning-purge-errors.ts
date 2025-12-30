import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { PruningState, ErroredToolCall } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { log } from "../../shared/logger"
import { MESSAGE_STORAGE } from "../../features/hook-message-injector"

export interface PurgeErrorsConfig {
  enabled: boolean
  turns: number
  protectedTools?: string[]
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

interface MessagePart {
  type: string
  parts?: ToolPart[]
}

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

function readMessages(sessionID: string): MessagePart[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return []

  const messages: MessagePart[] = []
  
  try {
    const files = readdirSync(messageDir).filter(f => f.endsWith(".json"))
    for (const file of files) {
      const content = readFileSync(join(messageDir, file), "utf-8")
      const data = JSON.parse(content)
      if (data.parts) {
        messages.push(data)
      }
    }
  } catch {
    return []
  }

  return messages
}

export function executePurgeErrors(
  sessionID: string,
  state: PruningState,
  config: PurgeErrorsConfig,
  protectedTools: Set<string>
): number {
  if (!config.enabled) return 0

  const messages = readMessages(sessionID)
  
  let currentTurn = 0
  
  for (const msg of messages) {
    if (!msg.parts) continue
    
    for (const part of msg.parts) {
      if (part.type === "step-start") {
        currentTurn++
      }
    }
  }
  
  state.currentTurn = currentTurn
  
  let turnCounter = 0
  let prunedCount = 0
  let tokensSaved = 0
  
  for (const msg of messages) {
    if (!msg.parts) continue
    
    for (const part of msg.parts) {
      if (part.type === "step-start") {
        turnCounter++
        continue
      }
      
      if (part.type !== "tool" || !part.callID || !part.tool) continue
      
      if (protectedTools.has(part.tool)) continue
      
      if (config.protectedTools?.includes(part.tool)) continue
      
      if (state.toolIdsToPrune.has(part.callID)) continue
      
      if (part.state?.status !== "error") continue
      
      const turnAge = currentTurn - turnCounter
      
      if (turnAge >= config.turns) {
        state.toolIdsToPrune.add(part.callID)
        prunedCount++
        
        const input = part.state.input
        if (input) {
          tokensSaved += estimateTokens(JSON.stringify(input))
        }
        
        const errorInfo: ErroredToolCall = {
          callID: part.callID,
          toolName: part.tool,
          turn: turnCounter,
          errorAge: turnAge,
        }
        
        state.erroredTools.set(part.callID, errorInfo)
        
        log("[pruning-purge-errors] pruned old error", {
          tool: part.tool,
          callID: part.callID,
          turn: turnCounter,
          errorAge: turnAge,
          threshold: config.turns,
        })
      }
    }
  }
  
  log("[pruning-purge-errors] complete", {
    prunedCount,
    tokensSaved,
    currentTurn,
    threshold: config.turns,
  })
  
  return prunedCount
}
