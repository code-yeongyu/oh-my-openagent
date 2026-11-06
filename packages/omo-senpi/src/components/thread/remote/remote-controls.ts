import type { ThreadToolResult } from "../contracts"
import { matchModel, modelPatternFailure, type ModelChoice } from "../tools/model-match"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { deviceOnline, outcomeFailure, replyData } from "./remote-ops"

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value)

// The engine's get_available_models reply ({models: [{provider, id, name?}]}); an entry of another shape is skipped.
const modelsOf = (value: unknown): ModelChoice[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        if (!isObject(entry)) return []
        const { provider, id, name } = entry
        return typeof provider === "string" && typeof id === "string" ? [{ provider, id, ...(typeof name === "string" ? { name } : {}) }] : []
      })
    : []

/**
 * thread_set_model on another device: the same rule as here, matched against that thread's own catalog
 * (`get_available_models`), then its engine's `set_model` on the session, both through the session's command path.
 */
export async function setModelRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, request: { readonly model: string; readonly provider?: string | undefined }): Promise<ThreadToolResult> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const empty = modelPatternFailure(request.model)
  if (empty !== undefined) return empty
  const listed = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_available_models", sessionId: row.session_id })
  if (listed.kind !== "ok") return outcomeFailure(listed, row.device)
  const matched = matchModel(modelsOf(replyData(listed.response)["models"]), request.model, request.provider)
  if (matched.kind !== "match") return matched
  const set = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "set_model", sessionId: row.session_id, provider: matched.model.provider, modelId: matched.model.id })
  if (set.kind !== "ok") return outcomeFailure(set, row.device)
  const applied = replyData(set.response)
  const provider = applied["provider"]
  const id = applied["id"]
  return { kind: "ok", thread_id: row.session_id, model: { provider: typeof provider === "string" ? provider : matched.model.provider, id: typeof id === "string" ? id : matched.model.id }, device: row.device }
}
