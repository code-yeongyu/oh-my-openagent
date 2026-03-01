import type { PluginInput } from "@opencode-ai/plugin"
import { log, normalizeSDKResponse } from "../../shared"
import { hasCouncilResponseTag } from "../../tools/council-archive/council-response-extractor"

type OpencodeClient = PluginInput["client"]

export async function sessionHasCouncilResponse(
  client: OpencodeClient,
  sessionID: string,
): Promise<boolean> {
  try {
    const response = await client.session.messages({
      path: { id: sessionID },
    })

    const messages = normalizeSDKResponse(
      response,
      [] as Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }>,
      { preferResponseOnMissingData: true },
    )

    return hasCouncilResponseTag(messages)
  } catch (error) {
    log("[council-response-checker] Error checking session for response tag:", {
      sessionID,
      error: String(error),
    })
    return false
  }
}
