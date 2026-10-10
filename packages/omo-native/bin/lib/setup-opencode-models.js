/**
 * Reads the model choices an OpenCode user made - the opencode config's `model`, `small_model` and
 * `agent.<name>` overrides, and the OpenCode edition's omo routing (`categories`, `agents`) - and
 * converts each into what the native harness reads. Provider ids go through provider-map.json, the
 * table the credential stage uses, and every provider/model is checked against the engine's model
 * list; what does not resolve is returned with its reason, never converted. Read-only.
 *
 * Native's startup migration (omo-senpi config-startup) runs the same conversion without the
 * engine's model list through `openCodeRoutingGap`, so both paths map names and providers alike.
 */

import { existsSync, readdirSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import providerMap from "./provider-map.json" with { type: "json" }
import { opencodeConfigSources, readOpencodeConfig } from "./setup-opencode-assets.js"

// The OpenCode edition's legacy plugin files, highest precedence first, as its config migration
// discovers them (omo-opencode config-migration/discovery-paths.ts CONFIG_FILE_NAMES).
const EDITION_FILES = ["oh-my-openagent.jsonc", "oh-my-openagent.json", "oh-my-opencode.jsonc", "oh-my-opencode.json"]

// The agents the native harness defines (senpi-task agents/builtin/index.ts BUILTIN_AGENTS). Any
// other name would become a new promptless agent there, not the OpenCode agent the user tuned.
export const NATIVE_AGENT_NAMES = [
  "explore",
  "librarian",
  "omo-native-code-reviewer",
  "omo-native-gate-reviewer",
  "omo-native-qa-executor",
  "plan-consultant",
  "plan-reviewer",
]

// OpenCode's own primary agents: the native main session has no per-mode agent, it runs the default model.
const OPENCODE_PRIMARY_AGENTS = new Set(["build", "plan"])

// The OpenCode edition's plan agents, keyed to the native agent that does the same job.
const AGENT_ALIASES = { metis: "plan-consultant", momus: "plan-reviewer" }

// omo-config-core schema/legacy-category-names.ts: the loader renames these and reports it.
const CATEGORY_ALIASES = { deep: "deep-low" }

// omo-config-core schema/reasoning-vocabulary.ts levels, plus the `none` and `auto` spellings it accepts.
const REASONING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto", "none"])
const MODEL_KEYS = ["model", "models", "fallback_models"]

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function record(value) {
  return isPlainObject(value) ? value : {}
}

// The first start of any current harness runs the config unification migration, which keeps none
// of a legacy file's categories or agents and moves the file to
// `~/.omo/migration-backup-<timestamp>-opencode-config/<path relative to home>`
// (omo-opencode config-migration/migration-plans.ts). The newest moved copy stands in for it.
function editionFile(path, home, notices) {
  if (existsSync(path)) return path
  const inHome = relative(home, path)
  const root = join(home, ".omo")
  if (inHome.startsWith("..") || isAbsolute(inHome) || !existsSync(root)) return path
  const moved = readdirSync(root)
    .filter((name) => /^migration-backup-.+-opencode-config$/.test(name))
    .sort()
    .reverse()
    .map((name) => join(root, name, inHome))
    .find((candidate) => existsSync(candidate))
  if (moved === undefined) return path
  notices.push(`NOTICE opencode: ${path} was moved to ${moved} by the omo config migration; its model routing is read from there`)
  return moved
}

/**
 * The OpenCode edition's own routing (`agents`, `categories`) from its legacy plugin files, or the
 * migration backups the unification migration moved them into.
 */
export function readEditionRouting({ home, env }) {
  const notices = []
  const globalDir = join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode")
  const explicitDir = env.OPENCODE_CONFIG_DIR?.trim()
  const directories = explicitDir ? [resolve(explicitDir), globalDir] : [globalDir]
  // readOpencodeConfig lets later files win, so the highest-precedence file is read last.
  const legacyFiles = directories
    .flatMap((directory) => EDITION_FILES.map((name) => editionFile(join(directory, name), home, notices)))
    .reverse()
  const edition = readOpencodeConfig(legacyFiles, "model choices", notices)
  return { agents: record(edition.agents), categories: record(edition.categories), notices }
}

/**
 * The raw choices, before any translation. `opencodeBlock` is the `[opencode]` block of the user's
 * omo.json[c]: the unification migration's target, so an entry there wins over the legacy files.
 */
export function readModelChoices({ home, env, opencodeBlock }) {
  const notices = []
  const opencode = readOpencodeConfig(opencodeConfigSources(home, env).files, "model choices", notices)
  const edition = readEditionRouting({ home, env })
  return {
    model: typeof opencode.model === "string" ? opencode.model : undefined,
    smallModel: typeof opencode.small_model === "string" ? opencode.small_model : undefined,
    opencodeAgents: record(opencode.agent),
    ...editionChoices(edition, opencodeBlock),
    notices: [...notices, ...edition.notices],
  }
}

function editionChoices(edition, opencodeBlock) {
  const block = record(opencodeBlock)
  return {
    categories: { ...edition.categories, ...record(block.categories) },
    agents: { ...edition.agents, ...record(block.agents) },
  }
}

function hasModelChoice(entry) {
  return isPlainObject(entry) && MODEL_KEYS.some((key) => entry[key] !== undefined)
}

export function hasModelChoices(raw) {
  return raw.model !== undefined || raw.smallModel !== undefined
    || [raw.opencodeAgents, raw.categories, raw.agents].some((entries) => Object.values(entries).some(hasModelChoice))
}

function engineProvider(provider, modelId, context) {
  const { oauthProviders, registry } = context
  // A provider opencode signed in to with OAuth (`openai` through a ChatGPT plan) is served here by
  // the provider the credential stage says to `/login` to (provider-map.json `oauthLogins`), not by
  // the same id, which would need an API key the user never had.
  const login = oauthProviders.has(provider) && Object.hasOwn(providerMap.oauthLogins, provider) ? providerMap.oauthLogins[provider] : undefined
  if (login !== undefined && registry?.models.get(login)?.has(modelId)) return login
  if (providerMap.builtinProviderIds.includes(provider)) return provider
  return providerMap.providers[provider] ?? provider
}

// `provider/model`, optionally with a `:level` or legacy `(level)` reasoning suffix. `max` is also a
// model-id ending, so it only counts as a suffix on a provider-qualified id (reasoning-vocabulary.ts).
function splitSuffix(text) {
  const paren = /^(.*\S)\s*\(([^()]+)\)$/.exec(text)
  if (paren && REASONING.has(paren[2].trim().toLowerCase())) return { selector: paren[1], suffix: `:${paren[2].trim().toLowerCase()}` }
  const colon = text.lastIndexOf(":")
  const token = text.slice(colon + 1).toLowerCase()
  if (colon <= 0 || !REASONING.has(token) || (token === "max" && !text.slice(0, colon).includes("/"))) return { selector: text, suffix: "" }
  return { selector: text.slice(0, colon), suffix: `:${token}` }
}

/**
 * `{ ref, provider, modelId }` for a model string the engine serves, else `{ reason }`. Without a
 * `context.registry` (Native startup, which has no engine model list) only the provider is checked,
 * against the engine's builtin providers.
 */
export function translateModelRef(raw, context) {
  if (typeof raw !== "string" || raw.trim() === "") return { reason: "not a model string" }
  const { selector, suffix } = splitSuffix(raw.trim())
  const slash = selector.indexOf("/")
  const { registry } = context
  if (slash <= 0) {
    // A bare id is matched against every provider by the native resolver, so any provider serving it will do.
    const served = registry === undefined || [...registry.models.values()].some((ids) => ids.has(selector))
    return served ? { ref: `${selector}${suffix}`, modelId: selector } : { reason: `no omo provider serves a model named ${selector}` }
  }
  const source = selector.slice(0, slash)
  const modelId = selector.slice(slash + 1)
  const provider = engineProvider(source, modelId, context)
  if (registry === undefined) {
    return providerMap.builtinProviderIds.includes(provider)
      ? { ref: `${provider}/${modelId}${suffix}`, provider, modelId }
      : { reason: `provider ${source} is not one omo serves or was carried over` }
  }
  const ids = registry.models.get(provider)
  if (ids === undefined) return { reason: `provider ${source} is not one omo serves or was carried over` }
  if (!ids.has(modelId)) {
    return {
      reason: context.registry.dynamic.has(provider)
        ? `${provider} lists its models only at runtime, so ${modelId} could not be checked`
        : `omo's ${provider} provider has no model ${modelId}`,
    }
  }
  return { ref: `${provider}/${modelId}${suffix}`, provider, modelId }
}

function reasoningOf(entry) {
  for (const key of ["reasoning", "reasoningEffort", "variant"]) {
    if (typeof entry[key] === "string" && entry[key].trim() !== "") return entry[key].trim()
  }
  return undefined
}

function temperatureOf(entry) {
  return typeof entry.temperature === "number" && entry.temperature >= 0 && entry.temperature <= 2 ? entry.temperature : undefined
}

function tuning(entry) {
  const reasoning = reasoningOf(entry)
  const temperature = temperatureOf(entry)
  return { ...(reasoning !== undefined ? { reasoning } : {}), ...(temperature !== undefined ? { temperature } : {}) }
}

function chainItem(item, take) {
  if (typeof item === "string") return take(item)
  if (!isPlainObject(item)) return undefined
  const model = take(item.model)
  return model === undefined ? undefined : { model, ...tuning(item) }
}

/**
 * The native shape of one category or agent entry: `model`, `models`, `reasoning`, `temperature`.
 * A deprecated `fallback_models` chain is folded into `models` behind `model`, the order the
 * OpenCode edition tried them in. Undefined when the entry named models and none of them resolve:
 * its tuning alone would retune the builtin chain the user had replaced.
 */
function convertEntry(label, entry, context, dropped, target) {
  const take = (raw) => {
    const result = translateModelRef(raw, context)
    if (result.reason !== undefined) dropped.push({ text: `${label} model ${String(raw)}: ${result.reason}`, target })
    return result.ref
  }
  const folded = !Array.isArray(entry.models) && entry.fallback_models !== undefined
  const chain = Array.isArray(entry.models)
    ? entry.models
    : folded ? [entry.model, ...[entry.fallback_models].flat()].filter((item) => item !== undefined) : []
  const model = !folded && entry.model !== undefined ? take(entry.model) : undefined
  const models = chain.map((item) => chainItem(item, take)).filter((item) => item !== undefined)
  if (hasModelChoice(entry) && model === undefined && models.length === 0) return undefined
  const converted = {
    ...(model !== undefined ? { model } : {}),
    ...(models.length > 0 ? { models } : {}),
    ...tuning(entry),
  }
  return Object.keys(converted).length > 0 ? converted : undefined
}

function convertAgents(raw, context, dropped) {
  const agents = new Map()
  const native = new Set(NATIVE_AGENT_NAMES)
  // opencode.json `agent.<name>` first, so the OpenCode edition's own `agents.<name>` wins over it.
  for (const [origin, entries] of [["opencode agent", raw.opencodeAgents], ["agent", raw.agents]]) {
    for (const [name, entry] of Object.entries(entries)) {
      if (!hasModelChoice(entry)) continue
      const target = Object.hasOwn(AGENT_ALIASES, name) ? AGENT_ALIASES[name] : name
      // A native name beside its alias in the same source wins, as categories resolve the pair.
      if (target !== name && Object.hasOwn(entries, target) && hasModelChoice(entries[target])) continue
      if (!native.has(target)) {
        dropped.push(OPENCODE_PRIMARY_AGENTS.has(name) && origin === "opencode agent"
          ? { text: `${origin} ${name}: the OpenCode primary agent; omo's main session runs the default model instead` }
          : {
            text: `${origin} ${name}: omo has no agent of that name (its agents: ${NATIVE_AGENT_NAMES.join(", ")}); route that work through a category instead`,
            target: { section: "categories", name: "<category>", model: firstModel(entry, context) },
          })
        continue
      }
      const converted = convertEntry(`${origin} ${name}`, entry, context, dropped, { section: "agents", name: target })
      if (converted !== undefined) agents.set(target, { entry: converted, from: name })
    }
  }
  return [...agents].map(([name, { entry, from }]) => ({ name, entry, from })).sort((left, right) => left.name.localeCompare(right.name))
}

// The model an unmappable agent named, as the native harness would spell it when it can.
function firstModel(entry, context) {
  const raw = entry.model ?? [entry.models, entry.fallback_models].flat().find((item) => item !== undefined)
  const text = isPlainObject(raw) ? raw.model : raw
  if (typeof text !== "string") return undefined
  return translateModelRef(text, context).ref ?? text
}

function convertCategories(raw, context, dropped) {
  const categories = new Map()
  for (const [name, entry] of Object.entries(raw.categories)) {
    if (!isPlainObject(entry)) continue
    const target = Object.hasOwn(CATEGORY_ALIASES, name) ? CATEGORY_ALIASES[name] : name
    // A canonical key beside its retired alias wins, as the loader resolves the pair.
    if (target !== name && Object.hasOwn(raw.categories, target)) continue
    const converted = convertEntry(`category ${name}`, entry, context, dropped, { section: "categories", name: target })
    if (converted !== undefined) categories.set(target, { entry: converted, from: name })
  }
  return [...categories].map(([name, { entry, from }]) => ({ name, entry, from })).sort((left, right) => left.name.localeCompare(right.name))
}

function convertDefault(model, context, dropped) {
  if (model === undefined) return undefined
  const result = translateModelRef(model, context)
  if (result.reason !== undefined) {
    dropped.push({ text: `default model ${model}: ${result.reason}` })
    return undefined
  }
  if (result.provider === undefined) {
    dropped.push({ text: `default model ${model}: names no provider, and omo's default model needs one` })
    return undefined
  }
  return { source: model, provider: result.provider, modelId: result.modelId, ref: `${result.provider}/${result.modelId}` }
}

/**
 * The raw choices converted against `registry` (engine-models.js `loadEngineModels`).
 * `oauthProviders` are the opencode provider ids whose opencode credential is an OAuth login.
 */
export function convertModelChoices(raw, registry, oauthProviders = new Set()) {
  const context = { registry, oauthProviders }
  const dropped = []
  const defaultModel = convertDefault(raw.model, context, dropped)
  if (raw.smallModel !== undefined) dropped.push({ text: `small_model ${raw.smallModel}: omo has no small-model setting` })
  const categories = convertCategories(raw, context, dropped)
  const agents = convertAgents(raw, context, dropped)
  return { defaultModel, categories, agents, dropped: dropped.map((item) => item.text) }
}

// omo-config-core loader/resolution.ts folds a legacy `[senpi]` block under `[native]`.
const NATIVE_BLOCKS = ["[senpi]", "[native]"]

/** The omo.jsonc member that sets `value` for `section.name` in the native harness. */
export function nativeRoutingLine(section, name, value) {
  const members = Object.entries(value).map(([key, member]) => `"${key}": ${JSON.stringify(member)}`).join(", ")
  return `"[native]": { "${section}": { "${name}": { ${members} } } }`
}

/**
 * The OpenCode edition's model settings (`edition`: readEditionRouting, overlaid by `document`'s
 * `[opencode]` block) that the native harness of `document` (a user omo.json[c]) does not use,
 * one line each with the omo.jsonc member that would set it natively. The legacy migration never
 * copies agents or categories (#7270), and `omo setup` carries them only with the user's consent, so
 * this only reports: Native's startup notice and `omo doctor` print these lines. Names and providers
 * convert as setup converts them, without the engine's model list; a key the native view (shared
 * base, `[senpi]`, `[native]`) already sets is the user's and is not reported.
 */
export function openCodeRoutingGap(document, edition) {
  const raw = { opencodeAgents: {}, ...editionChoices(edition, record(document)["[opencode]"]) }
  const context = { registry: undefined, oauthProviders: new Set() }
  const dropped = []
  const converted = { categories: convertCategories(raw, context, dropped), agents: convertAgents(raw, context, dropped) }
  const carriable = ["agents", "categories"].flatMap((section) => converted[section]
    .filter(({ name }) => !isConfigured(document, section, name))
    .map(({ name, entry, from }) => `${section === "agents" ? "agent" : "category"} ${from}: add ${nativeRoutingLine(section, name, entry)}`))
  const unmapped = dropped
    .filter(({ target }) => target === undefined || !isConfigured(document, target.section, target.name))
    .map(({ text, target }) => target === undefined
      ? text
      : `${text}: add ${nativeRoutingLine(target.section, target.name, { model: target.model ?? "<provider>/<model>" })}`)
  return [...carriable, ...unmapped]
}

/** The one-line lead of the report, for `lines` from openCodeRoutingGap. */
export function openCodeRoutingNotice(lines) {
  return `OpenCode edition model settings Native does not use; run omo setup to carry them over, or set them in omo.jsonc: ${lines.join("; ")}`
}

function isConfigured(document, section, name) {
  return [record(document)[section], ...NATIVE_BLOCKS.map((key) => record(record(document)[key])[section])]
    .some((entries) => Object.hasOwn(record(entries), name))
}
