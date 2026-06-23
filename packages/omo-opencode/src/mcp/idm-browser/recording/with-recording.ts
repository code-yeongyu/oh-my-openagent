import { recordAction } from "./session-recorder"
import { extractSessionId, summarizeResult } from "./result-summarizer"

export async function withRecording<T>(
  toolName: string,
  params: Record<string, unknown> & { recordingDir?: string },
  handler: () => Promise<T>,
): Promise<T> {
  const start = Date.now()
  let result: T | undefined
  let error: string | undefined
  try {
    result = await handler()
    return result
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    const sessionId = extractSessionId(result, params)
    if (sessionId) {
      const recordingDir = params.recordingDir
      recordAction({
        ts: start,
        tool: toolName,
        params: redactParams(params),
        sessionId,
        durationMs: Date.now() - start,
        success: !error,
        resultSummary: result !== undefined ? summarizeResult(result) : undefined,
        error,
        recordingDir,
      })
    }
  }
}

function redactParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    if (k === "expression" && typeof v === "string" && v.length > 1000) {
      out[k] = v.slice(0, 1000) + "…[truncated]"
    } else {
      out[k] = v
    }
  }
  return out
}
