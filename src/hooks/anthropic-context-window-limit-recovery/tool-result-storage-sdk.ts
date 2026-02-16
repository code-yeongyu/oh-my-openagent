import type { PluginInput } from "@opencode-ai/plugin"
import { TRUNCATION_MESSAGE } from "./storage-paths"
import type { ToolResultInfo } from "./tool-part-types"
import { patchPart } from "../../shared/opencode-http-api"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared"

type OpencodeClient = PluginInput["client"]

interface SDKToolPart {
  id: string
  type: string
  callID?: string
  tool?: string
  state?: {
    status?: string
    input?: Record<string, unknown>
    output?: string
    error?: string
    time?: { start?: number; end?: number; compacted?: number }
  }
}

interface SDKMessage {
  info?: { id?: string }
  parts?: SDKToolPart[]
}

export async function findToolResultsBySizeFromSDK(
  client: OpencodeClient,
  sessionID: string
): Promise<ToolResultInfo[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SDKMessage[], { preferResponseOnMissingData: true })
    const results: ToolResultInfo[] = []

    for (const msg of messages) {
      const messageID = msg.info?.id
      if (!messageID || !msg.parts) continue

      for (const part of msg.parts) {
        if (part.type === "tool" && part.state?.output && !part.state?.time?.compacted && part.tool) {
          results.push({
            partPath: "",
            partId: part.id,
            messageID,
            toolName: part.tool,
            outputSize: part.state.output.length,
          })
        }
      }
    }

    return results.sort((a, b) => b.outputSize - a.outputSize)
  } catch {
    return []
  }
}

export async function truncateToolResultAsync(
  client: OpencodeClient,
  sessionID: string,
  messageID: string,
  partId: string,
  part: SDKToolPart
): Promise<{ success: boolean; toolName?: string; originalSize?: number }> {
  if (!part.state?.output) return { success: false }

  const originalSize = part.state.output.length
  const toolName = part.tool

  const updatedPart: Record<string, unknown> = {
    ...part,
    state: {
      ...part.state,
      output: TRUNCATION_MESSAGE,
      time: {
        ...(part.state.time ?? { start: Date.now() }),
        compacted: Date.now(),
      },
    },
  }

  try {
    const patched = await patchPart(client, sessionID, messageID, partId, updatedPart)
    if (!patched) return { success: false }
    return { success: true, toolName, originalSize }
  } catch (error) {
    log("[context-window-recovery] truncateToolResultAsync failed", { error: String(error) })
    return { success: false }
  }
}

export async function countTruncatedResultsFromSDK(
  client: OpencodeClient,
  sessionID: string
): Promise<number> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SDKMessage[], { preferResponseOnMissingData: true })
    let count = 0

    for (const msg of messages) {
      if (!msg.parts) continue
      for (const part of msg.parts) {
        if (part.type === "tool" && part.state?.time?.compacted) count++
      }
    }

    return count
  } catch {
    return 0
  }
}

export async function getTotalToolOutputSizeFromSDK(
  client: OpencodeClient,
  sessionID: string
): Promise<number> {
  const results = await findToolResultsBySizeFromSDK(client, sessionID)
  return results.reduce((sum, result) => sum + result.outputSize, 0)
}
