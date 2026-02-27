import type { PluginInput } from "@opencode-ai/plugin"
import { log, normalizeSDKResponse } from "../../shared"

type OpencodeClient = PluginInput["client"]

const COUNCIL_RESPONSE_TAG = "</COUNCIL_MEMBER_RESPONSE>"

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

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.info?.role !== "assistant") continue
      const parts = msg.parts ?? []
      for (const part of parts) {
        if (part.type === "text" && part.text?.includes(COUNCIL_RESPONSE_TAG)) {
          return true
        }
      }
    }

    return false
  } catch (error) {
    log("[council-response-checker] Error checking session for response tag:", {
      sessionID,
      error: String(error),
    })
    return false
  }
}
