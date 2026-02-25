import type { PluginInput } from "@opencode-ai/plugin"
import { getServerBaseUrl } from "../../shared/opencode-http-api"
import { getServerBasicAuthHeader } from "../../shared/opencode-server-auth"
import { isRecord } from "../../shared/record-type-guard"
import { log } from "../../shared/logger"

export async function createIterationSession(
  ctx: PluginInput,
  parentSessionID: string,
  directory: string,
): Promise<string | null> {
  void parentSessionID

  const createResult = await ctx.client.session.create({
    body: {},
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
  const selectSession = getSelectSessionApi(client)
  if (selectSession) {
    const selectedViaApi = await trySelectSessionWithSdk(selectSession, sessionID)
    if (selectedViaApi) {
      return true
    }
  }

  const publish = getPublishTuiEventApi(client)
  if (publish) {
    const selectedViaPublish = await trySelectSessionWithPublish(publish, sessionID)
    if (selectedViaPublish) {
      return true
    }
  }

  return await trySelectSessionWithHttp(client, sessionID)
}

type SelectSessionApi = (args: { body: { sessionID: string } }) => Promise<unknown>
type PublishTuiEventApi = (args: {
  body: { type: "tui.session.select"; properties: { sessionID: string } }
}) => Promise<unknown>

function getSelectSessionApi(client: unknown): SelectSessionApi | null {
  if (!isRecord(client)) {
    return null
  }

  const clientRecord = client
  const tuiValue = clientRecord.tui
  if (!isRecord(tuiValue)) {
    return null
  }

  const selectSessionValue = tuiValue.selectSession
  if (typeof selectSessionValue !== "function") {
    return null
  }

  return (selectSessionValue as Function).bind(tuiValue) as SelectSessionApi
}

function getPublishTuiEventApi(client: unknown): PublishTuiEventApi | null {
  if (!isRecord(client)) {
    return null
  }

  const clientRecord = client
  const tuiValue = clientRecord.tui
  if (!isRecord(tuiValue)) {
    return null
  }

  const publishValue = tuiValue.publish
  if (typeof publishValue !== "function") {
    return null
  }

  return (publishValue as Function).bind(tuiValue) as PublishTuiEventApi
}

function hasError(result: unknown): boolean {
  return isRecord(result) && result.error !== undefined && result.error !== null
}

async function trySelectSessionWithSdk(selectSession: SelectSessionApi, sessionID: string): Promise<boolean> {
  try {
    const v2Style = await selectSession({ sessionID } as never)
    if (!hasError(v2Style)) {
      return true
    }
  } catch (error: unknown) {
    log("[ralph-loop] v2-style TUI select call failed, trying legacy shape", {
      sessionID,
      error: String(error),
    })
  }

  try {
    const v1Style = await selectSession({ body: { sessionID } })
    if (!hasError(v1Style)) {
      return true
    }
  } catch (error: unknown) {
    log("[ralph-loop] Failed to select session in TUI via SDK", {
      sessionID,
      error: String(error),
    })
  }

  return false
}

async function trySelectSessionWithPublish(publish: PublishTuiEventApi, sessionID: string): Promise<boolean> {
  try {
    const result = await publish({
      body: {
        type: "tui.session.select",
        properties: { sessionID },
      },
    })

    if (!hasError(result)) {
      return true
    }
  } catch (error: unknown) {
    log("[ralph-loop] Failed to select session via tui.publish", {
      sessionID,
      error: String(error),
    })
  }

  return false
}

async function trySelectSessionWithHttp(client: unknown, sessionID: string): Promise<boolean> {
  const baseUrl = getServerBaseUrl(client)
  const authorization = getServerBasicAuthHeader()

  if (!baseUrl || !authorization) {
    return false
  }

  try {
    const response = await fetch(`${baseUrl}/tui/select-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({ sessionID }),
      signal: AbortSignal.timeout(5000),
    })

    if (response.ok) {
      return true
    }

    log("[ralph-loop] TUI session select request failed", {
      sessionID,
      status: response.status,
    })
  } catch (error: unknown) {
    log("[ralph-loop] Failed to select session in TUI via HTTP fallback", {
      sessionID,
      error: String(error),
    })
  }

  return false
}
