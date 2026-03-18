import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { isSessionInBoulderLineage } from "./boulder-session-lineage"
import { HOOK_NAME } from "./hook-name"

export function extractSessionIdFromOutput(output: string): string | undefined {
  const taskMetadataBlocks = [...output.matchAll(/<task_metadata>([\s\S]*?)<\/task_metadata>/gi)]
  const lastTaskMetadataBlock = taskMetadataBlocks.at(-1)?.[1]
  if (lastTaskMetadataBlock) {
    const taskMetadataSessionMatch = lastTaskMetadataBlock.match(/session_id:\s*(ses_[a-zA-Z0-9_-]+)/i)
    if (taskMetadataSessionMatch) {
      return taskMetadataSessionMatch[1]
    }
  }

  const explicitSessionMatches = [...output.matchAll(/Session ID:\s*(ses_[a-zA-Z0-9_-]+)/g)]
  return explicitSessionMatches.at(-1)?.[1]
}

export async function validateSubagentSessionId(input: {
  client: PluginInput["client"]
  sessionID?: string
  lineageSessionIDs: string[]
}): Promise<string | undefined> {
  if (!input.sessionID || input.lineageSessionIDs.length === 0) {
    return undefined
  }

  const belongsToLineage = await isSessionInBoulderLineage({
    client: input.client,
    sessionID: input.sessionID,
    boulderSessionIDs: input.lineageSessionIDs,
  })

  if (!belongsToLineage) {
    log(`[${HOOK_NAME}] Ignoring extracted session id outside active lineage`, {
      sessionID: input.sessionID,
      lineageSessionIDs: input.lineageSessionIDs,
    })
    return undefined
  }

  return input.sessionID
}
