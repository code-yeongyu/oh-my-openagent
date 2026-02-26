import { isRecord } from "../../shared/record-type-guard"
import { log } from "../../shared/logger"

type SessionUpdateApi = (args: {
  path: { id: string }
  body: { title: string }
  query: { directory: string }
}) => Promise<unknown>

export function buildIterationSessionTitle(iteration: number, maxIterations: number): string {
  return `Ralph loop iteration ${iteration}/${maxIterations}`
}

export async function updateIterationSessionTitle(
  client: unknown,
  sessionID: string,
  directory: string,
  iteration: number,
  maxIterations: number,
): Promise<void> {
  const updateSession = getSessionUpdateApi(client)
  if (!updateSession) {
    return
  }

  try {
    await updateSession({
      path: { id: sessionID },
      body: { title: buildIterationSessionTitle(iteration, maxIterations) },
      query: { directory },
    })
  } catch (error: unknown) {
    log("[ralph-loop] Failed to update iteration session title", {
      sessionID,
      error: String(error),
    })
  }
}

function getSessionUpdateApi(client: unknown): SessionUpdateApi | null {
  if (!isRecord(client)) {
    return null
  }

  const sessionValue = client.session
  if (!isRecord(sessionValue)) {
    return null
  }

  const updateValue = sessionValue.update
  if (typeof updateValue !== "function") {
    return null
  }

  return (updateValue as Function).bind(sessionValue) as SessionUpdateApi
}
