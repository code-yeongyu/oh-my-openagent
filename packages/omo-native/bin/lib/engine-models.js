/**
 * The provider/model pairs the pinned engine can serve, read without starting it: the builtin
 * catalog every engine session is composed from, plus what `<agentDir>/models.json` adds.
 *
 * Building the engine's own ModelRuntime would give the same answer but costs seconds and writes
 * `auth.json` and `models-store.json` into the agent dir as a side effect, which a `--dry-run`
 * must never do.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { parseJsonc } from "./jsonc.js"
import { engineDependencyDir } from "./engine-dependency.js"
import { resolveSenpi } from "./package-paths.js"

// The same module the engine's model-runtime.js composes its builtins from
// (`builtinProviderCatalog.builtinProviders()`), in the pi-ai the engine itself resolves.
async function builtinCatalog() {
  const { packageRoot } = resolveSenpi()
  const piAiRoot = engineDependencyDir(packageRoot, "@earendil-works/pi-ai")
  if (piAiRoot === undefined) throw new Error(`the engine model catalog is missing: @earendil-works/pi-ai is not resolvable from ${packageRoot}`)
  const path = join(piAiRoot, "dist", "providers", "all.js")
  if (!existsSync(path)) throw new Error(`the engine model catalog is missing at ${path}`)
  return (await import(pathToFileURL(path).href)).builtinProviders()
}

function add(models, provider, id) {
  if (typeof id !== "string" || id === "") return
  if (!models.has(provider)) models.set(provider, new Set())
  models.get(provider).add(id)
}

function readModelsJson(path) {
  if (!existsSync(path)) return {}
  try {
    const providers = parseJsonc(readFileSync(path, "utf8"))?.providers
    return providers !== null && typeof providers === "object" && !Array.isArray(providers) ? providers : {}
  } catch {
    // The provider stage has already reported a malformed models.json; it adds no model here.
    return {}
  }
}

/**
 * `models` maps each provider id to the model ids it serves. `dynamic` names the providers that
 * list their models only at runtime (a provider with `refreshModels`), whose ids cannot be checked
 * offline. `customProviders` are providers the custom-provider stage would add (a dry run did not
 * write them).
 */
export async function loadEngineModels({ agentDir, customProviders = [], loadCatalog = builtinCatalog }) {
  const models = new Map()
  const dynamic = new Set()
  for (const provider of await loadCatalog()) {
    models.set(provider.id, new Set())
    for (const model of provider.getModels()) add(models, provider.id, model.id)
    if (typeof provider.refreshModels === "function") dynamic.add(provider.id)
  }
  // Registered by the engine's anthropic-subscription extension, not the catalog; it serves exactly
  // the anthropic catalog (extensions/builtin/anthropic-subscription/index.js `getModels("anthropic")`).
  for (const id of models.get("anthropic") ?? []) add(models, "anthropic-subscription", id)
  for (const [provider, entry] of Object.entries(readModelsJson(join(agentDir, "models.json")))) {
    if (!models.has(provider)) models.set(provider, new Set())
    for (const model of Array.isArray(entry?.models) ? entry.models : []) add(models, provider, model?.id)
  }
  for (const provider of customProviders) {
    for (const model of provider.config.models) add(models, provider.id, model.id)
  }
  return { models, dynamic }
}
