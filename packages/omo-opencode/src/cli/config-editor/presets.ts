import { createConnectedProvidersCacheStore } from "../../shared/connected-providers-cache"
import { getOmoOpenCodeCacheDir } from "../../shared/data-path"
import { createEditorProfile } from "./profiles"
import { setEditorValue, withEditorTransaction, type EditorSession } from "./session"
import { getEditorPresetPolicy, type EditorPresetId } from "./preset-policy"

export type EditorPresetRole = {
  readonly section: "agents" | "categories"
  readonly name: string
  readonly chain: readonly string[]
  readonly skipped: readonly { readonly model: string; readonly reason: string }[]
}
export type EditorPresetPreview = {
  readonly id: EditorPresetId
  readonly cacheUpdatedAt: string | undefined
  readonly cacheIssues: readonly string[]
  readonly roles: readonly EditorPresetRole[]
  readonly missingRoles: readonly string[]
  readonly complete: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function providerId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
    && !["__proto__", "constructor", "prototype"].includes(value)
}
function modelId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value)
}
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

/** Read the existing local store only. This never fetches providers or reads credentials. */
export function readEditorPresetCache(options: { readonly providerCacheDirectory?: string } = {}): unknown {
  return createConnectedProvidersCacheStore(() => options.providerCacheDirectory ?? getOmoOpenCodeCacheDir()).readProviderModelsCache()
}

/** A cache listing check only: neither authentication nor live model availability is tested. */
export function previewEditorPreset(id: string, cache: unknown): EditorPresetPreview {
  const policy = getEditorPresetPolicy(id)
  const issues: string[] = []
  const data = record(cache) ? cache : {}
  const timestamp = data["updatedAt"]
  const validTimestamp = typeof timestamp === "string"
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(timestamp)
    && Number.isFinite(Date.parse(timestamp))
    && new Date(`${timestamp.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === timestamp.slice(0, 10)
  const cacheUpdatedAt = validTimestamp ? timestamp : undefined
  if (!validTimestamp) issues.push("Provider-models cache timestamp is missing or invalid.")
  const connectedValue = data["connected"]
  const validConnected = Array.isArray(connectedValue) && connectedValue.every(providerId)
  const connected = new Set<string>(validConnected ? connectedValue : [])
  if (!validConnected) issues.push("Provider-models cache connected providers are missing or invalid.")
  else if (connected.size === 0) issues.push("Provider-models cache lists no connected providers.")
  const models = data["models"]
  if (!record(models)) issues.push("Provider-models cache model listings are missing or invalid.")
  const available = new Set<string>()
  if (record(models) && validTimestamp && validConnected) {
    for (const provider of connected) {
      if (!Object.hasOwn(models, provider)) continue
      const entries = models[provider]
      if (!Array.isArray(entries)) {
        issues.push(`Invalid model listing for ${provider}.`)
        continue
      }
      for (const entry of entries) {
        const id = typeof entry === "string" ? entry : record(entry) ? entry["id"] : undefined
        if (!modelId(id) || record(entry) && entry["provider"] !== undefined && entry["provider"] !== provider) {
          issues.push(`Ignored malformed model metadata for ${provider}.`)
          continue
        }
        available.add(`${provider}/${id}`)
      }
    }
  }
  const roles = policy.map(({ section, name, candidates }): EditorPresetRole => ({
    section, name,
    chain: candidates.filter((model) => available.has(model)),
    skipped: candidates.filter((model) => !available.has(model)).map((model) => ({
      model,
      reason: connected.has(model.slice(0, model.indexOf("/"))) ? "model not listed in cache" : "provider not connected in cache",
    })),
  }))
  const missingRoles = roles.filter((role) => role.chain.length === 0).map((role) => `${role.section}.${role.name}`)
  return freeze({ id: id as EditorPresetId, cacheUpdatedAt, cacheIssues: [...new Set(issues)], roles, missingRoles, complete: missingRoles.length === 0 })
}

/** Rebuild from the untrusted cache input; arbitrary/modified previews are never accepted. */
export function stageEditorPreset(session: EditorSession, name: string, id: string, cache: unknown): void {
  const preview = previewEditorPreset(id, cache)
  if (!preview.complete) throw new Error(`Cannot import preset; missing cache-listed models for: ${preview.missingRoles.join(", ")}.`)
  const agents: Record<string, { models: readonly string[] }> = {}
  const categories: Record<string, { model: string; fallback_models: readonly string[] }> = {}
  for (const role of preview.roles) {
    if (role.section === "agents") agents[role.name] = { models: role.chain }
    else {
      const primary = role.chain[0]
      if (primary === undefined) throw new Error(`Cannot import preset; missing model for ${role.name}.`)
      categories[role.name] = { model: primary, fallback_models: role.chain.slice(1) }
    }
  }
  withEditorTransaction(session, (staged) => {
    createEditorProfile(staged, name)
    setEditorValue(staged, ["profiles", name, "[opencode]"], { agents, categories })
  })
}
