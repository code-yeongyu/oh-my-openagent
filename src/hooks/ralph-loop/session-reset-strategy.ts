import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"

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
  const selectSession = getSelectSessionApi(client)
  if (!selectSession) {
    return false
  }

  try {
    await selectSession({ body: { sessionID } })
    return true
  } catch (error: unknown) {
    log("[ralph-loop] Failed to select session in TUI", {
      sessionID,
      error: String(error),
    })
    return false
  }
}

type SelectSessionApi = (args: { body: { sessionID: string } }) => Promise<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

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

  return selectSessionValue as SelectSessionApi
}
