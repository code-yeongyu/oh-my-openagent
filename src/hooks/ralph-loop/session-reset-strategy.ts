import type { PluginInput } from "@opencode-ai/plugin"
import { getServerBasicAuthHeader } from "../../shared/opencode-server-auth"
import { getServerBaseUrl, log } from "../../shared"

export async function createIterationSession(
  ctx: PluginInput,
  parentSessionID: string,
  directory: string,
): Promise<string | null> {
  const createResult = await ctx.client.session.create({
    body: {
      parentID: parentSessionID,
      title: "Ralph Loop Iteration",
    },
    query: { directory },
  })

  if (createResult.error || !createResult.data?.id) {
    log("[ralph-loop] Failed to create iteration session", {
      parentSessionID,
      error: String(createResult.error ?? "No session ID returned"),
    })
    return null
  }

  return createResult.data.id
}

export async function selectSessionInTui(
  client: PluginInput["client"],
  sessionID: string,
): Promise<boolean> {
  const baseUrl = getServerBaseUrl(client)
  const authorization = getServerBasicAuthHeader()

  if (!baseUrl || !authorization) {
    return false
  }

  const response = await fetch(`${baseUrl}/tui/select-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body: JSON.stringify({ sessionID }),
    signal: AbortSignal.timeout(5000),
  }).catch((error: unknown) => {
    log("[ralph-loop] Failed to select session in TUI", {
      sessionID,
      error: String(error),
    })
    return null
  })

  if (!response?.ok) {
    log("[ralph-loop] TUI session select request failed", {
      sessionID,
      status: response?.status,
    })
    return false
  }

  return true
}
