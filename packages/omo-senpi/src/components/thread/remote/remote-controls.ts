import type { ThreadToolResult } from "../contracts"
import { matchModel, modelPatternFailure, type ModelChoice } from "../tools/model-match"
import type { JsonObject, RemoteCommandOutcome, RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { deviceOnline, replyData } from "./remote-ops"
import { outcomeFailure } from "./outcome"

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

// The one model a catalog's exact `provider/id` names (matchModel's first rung, within `provider` when given): a match
// no later catalog change can make ambiguous, so a held catalog may decide it; the engine's set_model still confirms it.
function exactModel(catalog: readonly ModelChoice[], model: string, provider: string | undefined): ModelChoice | undefined {
  const pattern = model.trim().toLowerCase()
  const named = catalog.filter((choice) => `${choice.provider}/${choice.id}`.toLowerCase() === pattern && (provider === undefined || choice.provider.toLowerCase() === provider.trim().toLowerCase()))
  return named.length === 1 ? named[0] : undefined
}

/**
 * thread_set_model on another device: the same rule as here, matched against that thread's own catalog
 * (`get_available_models`), then its engine's `set_model` on the session, whose reply confirms the model. The
 * session's mirror holds the catalog after its first read: an exact provider/id it lists is set at once (one round
 * trip), and when that set fails the catalog is read again so the answer is the one a fresh catalog gives; any other
 * pattern is matched against a fresh catalog, exactly as before.
 */
export async function setModelRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, request: { readonly model: string; readonly provider?: string | undefined }): Promise<ThreadToolResult> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const empty = modelPatternFailure(request.model)
  if (empty !== undefined) return empty
  const catalog = { type: "get_available_models", sessionId: row.session_id }
  const fresh = async (): Promise<ThreadToolResult | { readonly kind: "match"; readonly model: ModelChoice }> => {
    const listed = await remote.sessions.sessionCommand(row.device, row.session_id, catalog, { fresh: true })
    if (listed.kind !== "ok") return outcomeFailure(listed, row.device)
    return matchModel(modelsOf(replyData(listed.response)["models"]), request.model, request.provider)
  }
  const set = (model: ModelChoice) => remote.sessions.sessionCommand(row.device, row.session_id, { type: "set_model", sessionId: row.session_id, provider: model.provider, modelId: model.id })
  const applied = (outcome: Extract<RemoteCommandOutcome, { readonly kind: "ok" }>, model: ModelChoice): ThreadToolResult => {
    const reply = replyData(outcome.response)
    const provider = reply["provider"]
    const id = reply["id"]
    return { kind: "ok", thread_id: row.session_id, model: { provider: typeof provider === "string" ? provider : model.provider, id: typeof id === "string" ? id : model.id }, device: row.device }
  }
  const listed = await remote.sessions.sessionCommand(row.device, row.session_id, catalog)
  if (listed.kind !== "ok") return outcomeFailure(listed, row.device)
  const held = listed.local === true ? exactModel(modelsOf(replyData(listed.response)["models"]), request.model, request.provider) : undefined
  if (held !== undefined) {
    const tried = await set(held)
    if (tried.kind === "ok") return applied(tried, held)
    // A set that may have run is answered as one, exactly as on dev; nothing more is sent.
    if (tried.kind === "uncertain") return outcomeFailure(tried, row.device)
    // A refused set may come from a held catalog that predates the model leaving that device: answer as a fresh catalog
    // would - its failure, or the model it matches set - and the set's own refusal when the re-read cannot be made.
    const rematched = await fresh()
    if (rematched.kind !== "match") return rematched.kind === "error" && rematched.error.code !== "model_not_found" && rematched.error.code !== "model_ambiguous" ? outcomeFailure(tried, row.device) : rematched
    if (rematched.model.provider === held.provider && rematched.model.id === held.id) return outcomeFailure(tried, row.device)
    const retried = await set(rematched.model)
    return retried.kind === "ok" ? applied(retried, rematched.model) : outcomeFailure(retried, row.device)
  }
  const matched = listed.local === true ? await fresh() : matchModel(modelsOf(replyData(listed.response)["models"]), request.model, request.provider)
  if (matched.kind !== "match") return matched
  const outcome = await set(matched.model)
  if (outcome.kind !== "ok") return outcomeFailure(outcome, row.device)
  return applied(outcome, matched.model)
}
