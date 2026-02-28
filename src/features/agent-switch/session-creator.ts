import { log } from "../../shared/logger"

type CreateClient = {
  session: {
    create?: (input?: { body?: { parentID?: string; title?: string } }) => Promise<unknown>
  }
}

function extractSessionId(response: unknown): string | undefined {
  if (typeof response !== "object" || response === null) {
    return undefined
  }

  const root = response as Record<string, unknown>

  if (typeof root.id === "string" && root.id.length > 0) {
    return root.id
  }

  const data = root.data
  if (typeof data === "object" && data !== null) {
    const dataRecord = data as Record<string, unknown>
    if (typeof dataRecord.id === "string" && dataRecord.id.length > 0) {
      return dataRecord.id
    }
  }

  return undefined
}

export async function createFreshSession(args: {
  client: CreateClient
  sourceSessionID: string
  targetAgent: string
}): Promise<string> {
  const { client, sourceSessionID, targetAgent } = args

  if (!client.session.create) {
    throw new Error("session.create not available on SDK client")
  }

  const response = await client.session.create({
    body: {
      parentID: sourceSessionID,
      title: `${targetAgent} (handoff)`,
    },
  })

  const newSessionID = extractSessionId(response)
  if (!newSessionID) {
    throw new Error(`failed to extract session ID from create response: ${JSON.stringify(response)}`)
  }

  log("[agent-switch] Created fresh session for handoff", {
    sourceSessionID,
    newSessionID,
    targetAgent,
  })

  return newSessionID
}
