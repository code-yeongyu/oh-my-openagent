import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import type { PruningState, ToolCallSignature } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { log } from "../../shared/logger"
import { getMessageDir } from "../../shared/opencode-message-dir"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { normalizeSDKResponse } from "../../shared"

type OpencodeClient = PluginInput["client"]

export interface DeduplicationConfig {
  enabled: boolean
  protectedTools?: string[]
}

interface ToolPart {
  type: string
  callID?: string
  tool?: string
  state?: {
    input?: unknown
    output?: string
  }
}

interface MessagePart {
  type: string
  parts?: ToolPart[]
}

export function createToolSignature(toolName: string, input: unknown): string {
  const sortedInput = sortObject(input)
  return `${toolName}::${JSON.stringify(sortedInput)}`
}

function sortObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== "object") return obj
  if (Array.isArray(obj)) return obj.map(sortObject)
  
  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  for (const key of keys) {
    sorted[key] = sortObject((obj as Record<string, unknown>)[key])
  }
  return sorted
}

function readMessages(sessionID: string): MessagePart[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return []

  const messages: MessagePart[] = []
  
  try {
    const files = readdirSync(messageDir).filter((f: string) => f.endsWith(".json"))
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

async function readMessagesFromSDK(client: OpencodeClient, sessionID: string): Promise<MessagePart[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const rawMessages = normalizeSDKResponse(response, [] as Array<{ parts?: ToolPart[] }>, { preferResponseOnMissingData: true })
    return rawMessages.filter((m) => m.parts) as MessagePart[]
  } catch {
    return []
  }
}

export async function executeDeduplication(
  sessionID: string,
  state: PruningState,
  config: DeduplicationConfig,
  protectedTools: Set<string>,
  client?: OpencodeClient,
): Promise<number> {
  if (!config.enabled) return 0

  const messages = (client && isSqliteBackend())
    ? await readMessagesFromSDK(client, sessionID)
    : readMessages(sessionID)

  const signatures = new Map<string, ToolCallSignature[]>()
  
  let currentTurn = 0
  
  for (const msg of messages) {
    if (!msg.parts) continue
    
    for (const part of msg.parts) {
      if (part.type === "step-start") {
        currentTurn++
        continue
      }
      
      if (part.type !== "tool" || !part.callID || !part.tool) continue
      
      if (protectedTools.has(part.tool)) continue
      
      if (config.protectedTools?.includes(part.tool)) continue
      
      if (state.toolIdsToPrune.has(part.callID)) continue
      
      const signature = createToolSignature(part.tool, part.state?.input)
      
      if (!signatures.has(signature)) {
        signatures.set(signature, [])
      }
      
      signatures.get(signature)!.push({
        toolName: part.tool,
        signature,
        callID: part.callID,
        turn: currentTurn,
      })
      
      if (!state.toolSignatures.has(signature)) {
        state.toolSignatures.set(signature, [])
      }
      state.toolSignatures.get(signature)!.push({
        toolName: part.tool,
        signature,
        callID: part.callID,
        turn: currentTurn,
      })
    }
  }
  
  let prunedCount = 0
  let tokensSaved = 0
  
  for (const [signature, calls] of signatures) {
    if (calls.length > 1) {
      const toPrune = calls.slice(0, -1)
      
      for (const call of toPrune) {
        state.toolIdsToPrune.add(call.callID)
        prunedCount++
        
        const output = findToolOutput(messages, call.callID)
        if (output) {
          tokensSaved += estimateTokens(output)
        }
        
        log("[pruning-deduplication] pruned duplicate", {
          tool: call.toolName,
          callID: call.callID,
          turn: call.turn,
          signature: signature.substring(0, 100),
        })
      }
    }
  }
  
  log("[pruning-deduplication] complete", {
    prunedCount,
    tokensSaved,
    uniqueSignatures: signatures.size,
  })
  
  return prunedCount
}

function findToolOutput(messages: MessagePart[], callID: string): string | null {
  for (const msg of messages) {
    if (!msg.parts) continue
    
    for (const part of msg.parts) {
      if (part.type === "tool" && part.callID === callID && part.state?.output) {
        return part.state.output
      }
    }
  }
  
  return null
}
