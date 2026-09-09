import { isEmptyNoProgressAssistantTurnInfo } from "../../features/background-agent"
import type { RuntimeFallbackPluginInput } from "./types"

export type PersistedSilentCleanStop = {
  readonly messageID: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function hasOnlyStepMarkerParts(value: unknown): boolean {
  return Array.isArray(value) && value.every((part) => {
    if (!isRecord(part)) return false
    return part.type === "step-start" || part.type === "step-finish"
  })
}

export async function resolvePersistedSilentCleanStop(
  ctx: RuntimeFallbackPluginInput,
  sessionID: string,
): Promise<PersistedSilentCleanStop | undefined> {
  try {
    const response = await ctx.client.session.messages({
      path: { id: sessionID },
      query: { directory: ctx.directory, limit: 1 },
    })
    if (!isRecord(response) || !Array.isArray(response.data) || response.data.length === 0) {
      return undefined
    }

    const finalMessage = response.data.at(-1)
    if (!isRecord(finalMessage) || !isRecord(finalMessage.info)) return undefined

    const info = finalMessage.info
    const messageID = info.id
    const matchesSilentCleanStop = typeof messageID === "string"
      && info.sessionID === sessionID
      && info.error === undefined
      && isEmptyNoProgressAssistantTurnInfo(info)
      && hasOnlyStepMarkerParts(finalMessage.parts)
    if (!matchesSilentCleanStop) return undefined
    return { messageID }
  } catch {
    return undefined
  }
}
