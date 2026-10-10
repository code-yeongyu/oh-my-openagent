/**
 * The custom-provider stage of `omo setup`: classifies what `setup-opencode-providers.js` planned
 * against the engine's `<agentDir>/models.json` and `auth.json`. A provider id models.json already
 * has, and a key auth.json already has, are never overwritten. `planProviders` only reads;
 * `applyProviders` is the one writer.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { readAuthStore, timestamp, writeAuthStore } from "./auth-store.js"
import { parseJsonc } from "./jsonc.js"

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// The engine strips comments before parsing models.json (model-config.js `ModelConfig.parse`), so a
// commented file is read the same way here. `providers` must be an object (model-config-schema.js
// `ModelsConfigSchema`); a file where it is not is one the engine already rejects, and is left alone.
function readModelsTarget(path) {
  if (!existsSync(path)) return { document: { providers: {} }, bytes: undefined }
  const bytes = readFileSync(path, "utf8")
  try {
    const document = parseJsonc(bytes)
    if (!isPlainObject(document)) throw new Error("expected object")
    const providers = document.providers ?? {}
    if (!isPlainObject(providers)) throw new Error("expected providers object")
    return { document: { ...document, providers }, bytes }
  } catch {
    return { malformed: true, bytes }
  }
}

function classify(plan, models, auth) {
  const result = { added: [], skippedExisting: [], blocked: [], keys: [], keysExisting: [], keysBlocked: [] }
  for (const provider of plan.providers) {
    if (models.malformed) {
      result.blocked.push(provider.id)
      continue
    }
    if (Object.hasOwn(models.document.providers, provider.id)) {
      result.skippedExisting.push(provider.id)
      continue
    }
    result.added.push(provider)
    // A key only ever rides with the provider it belongs to: never onto a models.json entry the user wrote.
    if (provider.key === undefined) continue
    if (auth.malformed) result.keysBlocked.push(provider.id)
    else if (Object.hasOwn(auth.entries, provider.id)) result.keysExisting.push(provider.id)
    else result.keys.push({ provider: provider.id, key: provider.key.key })
  }
  return result
}

/** Where the key of an added provider comes from, in the words the setup summary prints. */
export function providerKeySource(provider, result) {
  if (result.keysExisting.includes(provider.id)) return "kept the existing auth.json key"
  if (result.keysBlocked.includes(provider.id)) return "key not imported (malformed auth.json)"
  if (provider.key !== undefined) return `key from ${provider.key.source}`
  return `no key found - /login ${provider.id} inside omo`
}

function list(label, ids) {
  return `${label}: ${ids.length > 0 ? ids.join(", ") : "none"}`
}

export function providerPlanLines({ result }) {
  return [list("planned-providers", result.added.map((provider) => provider.id)), list("providers-skipped-existing", result.skippedExisting)]
}

export function providerCounts({ result }) {
  return [
    list("providers-imported", result.added.map((provider) => provider.id)),
    `provider-keys-imported: ${result.keys.length}`,
    `providers-skipped-existing: ${result.skippedExisting.length}`,
  ]
}

export function providerQuestion({ result, paths }) {
  return `Import ${result.added.length} custom provider(s) into ${paths.models} and ${result.keys.length} API key(s) into ${paths.auth}? [y/N] `
}

function writeModels(path, target, added) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (target.bytes !== undefined) copyFileSync(path, `${path}.bak-${timestamp()}`)
  const next = { ...target.document, providers: { ...target.document.providers } }
  for (const provider of added) next.providers[provider.id] = provider.config
  // A models.json symlinked from a dotfiles checkout is written through the link, not replaced by a copy.
  const destination = target.bytes !== undefined ? realpathSync(path) : path
  const temporary = `${destination}.tmp-${process.pid}`
  try {
    // Provider headers can carry tokens, so this file gets the same 0600 the auth store does.
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    renameSync(temporary, destination)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

/** `source` is `planOpencodeProviders`' result, classified against the engine's files. Read-only. */
export function planProviders(source, agentDir) {
  const paths = { models: join(agentDir, "models.json"), auth: join(agentDir, "auth.json") }
  const models = readModelsTarget(paths.models)
  const result = classify(source, models, readAuthStore(paths.auth))
  const notices = [...source.notices]
  if (result.blocked.length > 0) notices.push(`WARN senpi: malformed models.json; these custom providers were not imported: ${result.blocked.join(", ")}`)
  return { paths, models, notices, result, skipped: source.skipped, present: source.providers.length > 0, pending: result.added.length }
}

export function applyProviders(plan) {
  writeModels(plan.paths.models, plan.models, plan.result.added)
  // Re-read: the credential stage of the same run may have just written auth.json, after this plan
  // was classified. A mapped credential target can also be a custom provider id (claude-sdk-oauth ->
  // anthropic-subscription), so a key written since the plan is kept, never overwritten.
  const auth = readAuthStore(plan.paths.auth)
  plan.result.keys = auth.malformed ? [] : plan.result.keys.filter((item) => !Object.hasOwn(auth.entries, item.provider))
  if (plan.result.keys.length > 0) writeAuthStore(plan.paths.auth, auth, plan.result.keys)
}
