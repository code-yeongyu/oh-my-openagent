import { slugifyLabel } from "../../recording/recording-directory"
import { renameRecording, bumpRecordingUsage } from "../../../../automation/hermes/recording-metadata"
import type { BrowserPool } from "../../pool"

export type EndSessionParams = {
  sessionId?: string
  accountId?: string
  label?: string
}

export async function handleEndSession(pool: BrowserPool, params: EndSessionParams) {
  if (!params.sessionId) {
    return {
      content: [{ type: "text" as const, text: "No sessionId provided" }],
      isError: true,
    }
  }

  const session = pool.getSession(params.sessionId)
  const currentRecordingDir = session?.recordingDir

  if (!pool.hasSession(params.sessionId)) {
    return {
      content: [{ type: "text" as const, text: `Session ${params.sessionId} not found` }],
      isError: true,
    }
  }

  await pool.release(params.sessionId)

  let renameError: string | undefined
  if (params.label && currentRecordingDir) {
    try {
      const oldName = currentRecordingDir.split("/").pop()!
      const newName = slugifyLabel(params.label)
      if (oldName !== newName) {
        await renameRecording(oldName, newName)
      } else {
        await bumpRecordingUsage(oldName)
      }
    } catch (err) {
      renameError = err instanceof Error ? err.message : String(err)
    }
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ 
        closed: params.sessionId,
        renameError
      }),
    }],
  }
}
