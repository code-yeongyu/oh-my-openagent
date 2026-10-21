/**
 * Reads the custom providers (`provider.<id>` blocks) of the OpenCode user-scope config - the same
 * merged files the MCP reader uses - and converts each one into the provider entry the engine's
 * `models.json` accepts, plus the API key to store for it. Read-only: nothing here writes.
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { literalConfigValue } from "./engine-config-value.js"
import {
  convertPlainField,
  convertToObjectField,
  legacyConfigValue,
  opencodeConfigSources,
  readOpencodeSection,
  shouldEmitReferenceObjects,
} from "./setup-opencode-assets.js"
import providerMap from "./provider-map.json" with { type: "json" }

// The AI SDK package an OpenCode provider names decides its wire protocol; each engine api id here
// speaks the same one (pi-ai compat.js BUILTIN_APIS). Any other package is reported, never guessed.
export const API_BY_NPM = {
  "@ai-sdk/openai-compatible": "openai-completions",
  "@ai-sdk/anthropic": "anthropic-messages",
  "@ai-sdk/openai": "openai-responses",
}

// OpenCode's own fallback for a provider that names no package (provider.ts, "extend database from
// config"): a custom provider without `npm` is spoken to as OpenAI-compatible.
const DEFAULT_NPM = "@ai-sdk/openai-compatible"

const MODEL_INPUTS = new Set(["text", "image", "video"])
const ENV_NAME = /^\w+$/

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function text(value) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function builtinProviderIds() {
  return new Set([...providerMap.builtinProviderIds, ...Object.keys(providerMap.providers)])
}

// The engine resolves api keys and header values as config values at load time: literal bytes
// are escaped, OpenCode's `{env:NAME}` becomes the engine's `${NAME}`, and any `{file:...}` or
// `{env:...}` reference in an object-shaped field becomes a structured reference object
// (`{$file: ...}` / `{$env: ...}` / `{$concat: [...]}`) that the engine reads at load. Returns
// undefined when a placeholder is left that the engine has no spelling for.
//
// `legacy` is the engine-version gate closed: the value lands in the engine config as a plain
// string, so the pre-change rules apply (a `{file:...}` or malformed `{env:...}` is refused).
function configValue(value, baseDir = "", legacy = false) {
  if (legacy) return legacyConfigValue(value)
  const split = convertToObjectField(value, baseDir)
  if (split.refused) return undefined
  return split.value
}

// @ai-sdk/anthropic posts to `<baseURL>/messages` (its default base is https://api.anthropic.com/v1);
// the engine's Anthropic client appends `/v1/messages` itself (its builtin base is
// https://api.anthropic.com), so the `/v1` has to leave the base. Any other shape is not expressible.
function engineBaseUrl(api, baseURL) {
  if (api !== "anthropic-messages") return baseURL
  return /^(.+)\/v1\/?$/.exec(baseURL)?.[1]
}

function readOpencodeAuth(home, env, notices) {
  const path = join(env.XDG_DATA_HOME || join(home, ".local", "share"), "opencode", "auth.json")
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    notices.push("WARN opencode: could not parse auth.json; custom provider keys stored there were not imported")
    return {}
  }
}

// OpenCode's order (provider.ts): `options.apiKey` wins, else the auth.json `api` entry, else the
// one env var `env` names - a list of several names never yields a key.
function convertKey(id, entry, opencodeAuth, baseDir, legacy, notices) {
  const kind = entry.catalog === true ? "catalog provider" : "custom provider"
  const inline = text(entry.options?.apiKey)
  if (inline !== undefined) {
    const key = configValue(inline, baseDir, legacy)
    if (key !== undefined) return { key, source: "opencode config apiKey" }
    notices.push(
      legacy
        ? `NOTICE opencode: ${kind} ${id} apiKey has a {file:...} or malformed {env:NAME} placeholder that omo cannot express in the plain-string form; the key was not imported - start omo and run /login ${id}, or fix the apiKey value.`
        : `NOTICE opencode: ${kind} ${id} apiKey has a malformed {env:NAME} placeholder (NAME outside the identifier shape) that omo refuses to ship; the {file:...} form is supported (the engine resolves it at load time). Start omo and run /login ${id}, or fix the apiKey value.`,
    )
    return undefined
  }
  const stored = opencodeAuth[id]
  if (stored?.type === "api" && text(stored.key) !== undefined) return { key: literalConfigValue(stored.key), source: "opencode auth.json" }
  const names = Array.isArray(entry.env) ? entry.env : []
  if (names.length === 1 && ENV_NAME.test(names[0])) return { key: `\${${names[0]}}`, source: `environment variable ${names[0]}` }
  return undefined
}

// A URL still holding a placeholder has no engine spelling at URL position: the engine sends
// baseUrl verbatim, while OpenCode substitutes `{env:...}` / `{file:...}` into URLs in its
// own config and `${NAME}` into the URL itself. URLs that have reached us must be opaque.
function fixedUrl(value) {
  return value !== undefined && !/\{(?:env|file):|\$\{/.test(value) ? value : undefined
}

// A display name is a plain string the engine reads as-is, so it cannot hold a reference object.
// A `{file:...}` in one is reported, not written.
function convertModelName(source, providerId, id, notices) {
  const raw = text(source.name)
  if (raw === undefined) return undefined
  const converted = convertPlainField(raw)
  if (converted.refused) {
    notices.push(`NOTICE opencode: model ${providerId}/${id} name has ${converted.reason}; a model name cannot hold a reference value; not imported - inline the value`)
    return null
  }
  return converted.value
}

// The engine's model entry carries no apiKey and no headers, so a per-model key or header has
// nowhere to land. It is reported rather than dropped in silence.
function reportModelFieldsWithoutHome(source, providerId, id, notices) {
  if (text(source.options?.apiKey) !== undefined) {
    notices.push(`NOTICE opencode: model ${providerId}/${id} apiKey is not carried over; the engine's model entry has no apiKey field - set it on the provider, or add the model to models.json by hand`)
  }
  if (isPlainObject(source.options?.headers) && Object.keys(source.options.headers).length > 0) {
    notices.push(`NOTICE opencode: model ${providerId}/${id} headers are not carried over; the engine's model entry has no headers field - set them on the provider, or add the model to models.json by hand`)
  }
}

// The endpoint a model is sent to: the provider's `options.baseURL`, else the model's own
// `provider.api`, else the provider's `api`. A model's own endpoint that is not a fixed URL is
// refused rather than silently falling back to the provider's, because a url field has no
// spelling for a reference object.
function resolveModelEndpoint(provider, source, id, api, notices) {
  const own = text(source.provider?.api)
  if (own !== undefined && fixedUrl(own) === undefined) {
    notices.push(`NOTICE opencode: model ${provider.id}/${id} baseURL ${own} is not a fixed URL omo's ${api} client can use; not imported - set the url to a fixed value`)
    return undefined
  }
  const baseURL = provider.optionsBaseURL ?? own ?? provider.baseURL
  if (fixedUrl(baseURL) === undefined) {
    notices.push(`NOTICE opencode: model ${provider.id}/${id} baseURL ${baseURL} is not a fixed URL omo's ${api} client can use; not imported - set the url to a fixed value`)
    return undefined
  }
  const baseUrl = engineBaseUrl(api, baseURL)
  if (baseUrl === undefined) {
    notices.push(`NOTICE opencode: model ${provider.id}/${id} baseURL ${baseURL} does not end in /v1, which omo's ${api} client needs; not imported - the url must end in /v1`)
    return undefined
  }
  return baseUrl
}

function convertModel(provider, id, entry, notices) {
  const source = isPlainObject(entry) ? entry : {}
  const npm = text(source.provider?.npm)
  const api = npm === undefined ? provider.api : API_BY_NPM[npm]
  if (api === undefined) {
    notices.push(`NOTICE opencode: model ${provider.id}/${id} uses npm package ${npm}, which omo has no API adapter for; not imported`)
    return undefined
  }
  // OpenCode sends every model to `options.baseURL`, else to the model's own `provider.api`, else to
  // the provider's `api` (provider.ts "extend database from config" and the SDK baseURL). A model
  // whose protocol differs from its provider's needs that URL in its own engine spelling.
  const baseUrl = resolveModelEndpoint(provider, source, id, api, notices)
  if (baseUrl === undefined) return undefined
  const name = convertModelName(source, provider.id, id, notices)
  if (name === null) return undefined
  reportModelFieldsWithoutHome(source, provider.id, id, notices)
  const input = Array.isArray(source.modalities?.input) ? source.modalities.input.filter((kind) => MODEL_INPUTS.has(kind)) : []
  return {
    id,
    // OpenCode's model `id` is the id sent to the API when the key is an alias; the engine's
    // `upstreamModelId` replaces the request model id the same way (model-runtime.js).
    ...(text(source.id) !== undefined && source.id !== id ? { upstreamModelId: source.id } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(api !== provider.api ? { api } : {}),
    ...(baseUrl !== provider.baseUrl ? { baseUrl } : {}),
    ...(typeof source.reasoning === "boolean" ? { reasoning: source.reasoning } : {}),
    ...(input.length > 0 ? { input } : {}),
    ...(positive(source.limit?.context) !== undefined ? { contextWindow: source.limit.context } : {}),
    ...(positive(source.limit?.output) !== undefined ? { maxTokens: source.limit.output } : {}),
  }
}

function convertHeaders(headers, baseDir, legacy) {
  if (!isPlainObject(headers)) return {}
  const converted = {}
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== "string") continue
    const resolved = configValue(value, baseDir, legacy)
    if (resolved === undefined) return undefined
    converted[name] = resolved
  }
  return converted
}

function convertProvider(id, entry, context) {
  const { notices } = context
  const kind = isPlainObject(entry) && entry.catalog === true ? "catalog provider" : "custom provider"
  if (context.builtin.has(id)) {
    notices.push(`NOTICE opencode: provider ${id} is one omo already serves; its opencode overrides (baseURL, models) are not imported - set them in models.json by hand if you need them`)
    return undefined
  }
  if (!isPlainObject(entry)) return undefined
  const npm = text(entry.npm) ?? DEFAULT_NPM
  const api = API_BY_NPM[npm]
  if (api === undefined) {
    notices.push(`NOTICE opencode: ${kind} ${id} uses npm package ${npm}, which omo has no API adapter for; not imported`)
    return undefined
  }
  const baseURL = text(entry.options?.baseURL) ?? text(entry.api)
  if (fixedUrl(baseURL) === undefined) {
    notices.push(`NOTICE opencode: ${kind} ${id} has no fixed baseURL; not imported - omo needs a literal endpoint URL`)
    return undefined
  }
  const baseUrl = engineBaseUrl(api, baseURL)
  if (baseUrl === undefined) {
    notices.push(`NOTICE opencode: ${kind} ${id} baseURL ${baseURL} does not end in /v1, which omo's Anthropic client needs; not imported`)
    return undefined
  }
  const headers = convertHeaders(entry.options?.headers, context.baseDir, context.legacy)
  if (headers === undefined) {
    notices.push(
      context.legacy
        ? `NOTICE opencode: ${kind} ${id} has a header with a {file:...} or malformed {env:NAME} placeholder omo cannot express in the plain-string form; not imported`
        : `NOTICE opencode: ${kind} ${id} has a header with a malformed {env:NAME} placeholder omo cannot express; not imported`,
    )
    return undefined
  }
  const models = Object.entries(isPlainObject(entry.models) ? entry.models : {})
    .map(([modelId, model]) => convertModel({ id, api, baseURL, baseUrl, optionsBaseURL: text(entry.options?.baseURL) }, modelId, model, notices))
    .filter((model) => model !== undefined)
  if (models.length === 0) {
    notices.push(`NOTICE opencode: ${kind} ${id} declares no models omo can use; not imported`)
    return undefined
  }
  // The shape model-config-schema.js ProviderConfigSchema validates and provider-composer.js
  // modelFromJson composes: `api` and `baseUrl` at provider level feed every model.
  const config = {
    ...(text(entry.name) !== undefined ? { name: entry.name } : {}),
    baseUrl,
    api,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    models,
  }
  return { id, npm, config, key: convertKey(id, entry, context.opencodeAuth, context.baseDir, context.legacy, notices) }
}

// OpenCode's own copy of the models.dev catalog (core/src/models-dev.ts: Global.Path.cache, or
// OPENCODE_MODELS_PATH): every provider OpenCode serves without a config block is defined there.
function readOpencodeCatalog(home, env, notices) {
  const path = env.OPENCODE_MODELS_PATH || join(env.XDG_CACHE_HOME || join(home, ".cache"), "opencode", "models.json")
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    return isPlainObject(parsed) ? parsed : undefined
  } catch {
    notices.push("WARN opencode: could not parse its models.dev catalog cache; catalog providers were not imported")
    return undefined
  }
}

// OpenCode extends a catalog model field by field ("extend database from config"): nested objects such
// as `limit`, `modalities` and `provider` are merged, so overriding `limit.context` keeps `limit.output`.
function overlay(base, own) {
  if (!isPlainObject(base) || !isPlainObject(own)) return own
  const merged = { ...base }
  for (const [key, value] of Object.entries(own)) merged[key] = isPlainObject(value) && isPlainObject(base[key]) ? overlay(base[key], value) : value
  return merged
}

// A catalog provider in the shape of a `provider.<id>` block, so one converter serves both. Models
// models.dev marks deprecated stay behind, as OpenCode hides them.
function catalogEntry(entry) {
  if (!isPlainObject(entry) || !isPlainObject(entry.models)) return undefined
  const models = Object.fromEntries(Object.entries(entry.models).filter(([, model]) => isPlainObject(model) && model.status !== "deprecated"))
  return { name: entry.name, npm: entry.npm, api: entry.api, env: entry.env, models, catalog: true }
}

// OpenCode serves a catalog provider as soon as it has a key, and a `provider.<id>` block for it
// extends the catalog entry rather than replacing it (#10158). Every non-builtin provider that
// OpenCode holds an API key for, or that a config block names, is looked up in the catalog.
function withCatalog(config, opencodeAuth, builtin, home, env, notices) {
  const keyed = Object.keys(opencodeAuth).filter((id) => opencodeAuth[id]?.type === "api")
  const ids = [...new Set([...keyed, ...Object.keys(config)])].filter((id) => !builtin.has(id))
  if (ids.length === 0) return config
  // Only an id that has no endpoint of its own depends on the catalog; a broken cache is worth a
  // warning for that one alone, while a block with its own endpoint still extends the catalog when found.
  const ownEndpoint = (id) => isPlainObject(config[id]) && (text(config[id].options?.baseURL) !== undefined || text(config[id].api) !== undefined)
  const catalog = readOpencodeCatalog(home, env, ids.some((id) => !ownEndpoint(id)) ? notices : [])
  if (catalog === undefined) {
    const missing = ids.filter((id) => !Object.hasOwn(config, id))
    if (missing.length > 0) notices.push(`NOTICE opencode: no models.dev catalog cache found, so ${missing.join(", ")} could not be described - if opencode serves them, run opencode once, then omo setup again`)
    return config
  }
  const merged = { ...config }
  for (const id of ids) {
    const base = catalogEntry(catalog[id])
    if (base === undefined) continue
    const own = isPlainObject(config[id]) ? config[id] : {}
    const ownModels = isPlainObject(own.models) ? own.models : {}
    const models = { ...base.models }
    for (const [modelId, model] of Object.entries(ownModels)) models[modelId] = overlay(models[modelId], model)
    merged[id] = { ...base, ...own, models }
  }
  return merged
}

/** Every OpenCode custom or catalog provider the engine can serve, converted; everything else as a notice. */
export function planOpencodeProviders(options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const notices = []
  const sources = opencodeConfigSources(home, env)
  const config = readOpencodeSection(sources.files, "provider", "custom providers", notices)
  const builtin = builtinProviderIds()
  // With no provider block, a bad auth.json is the credential stage's to report.
  const opencodeAuth = readOpencodeAuth(home, env, Object.keys(config).length > 0 ? notices : [])
  const declared = withCatalog(config, opencodeAuth, builtin, home, env, notices)
  // auth.json is only a key source here; with no provider to describe it is the credential stage's alone.
  if (Object.keys(declared).length === 0) return { providers: [], skipped: [], notices }
  // baseDir is the directory of the OpenCode config file the entry came from. The config is
  // MERGED across every file OpenCode reads, so the file a given entry came from is not known
  // here; the global config directory is the best available anchor. A relative `{file:...}` path
  // therefore resolves against the global dir, not against the file that wrote it.
  const baseDir = sources.files[0] ? dirname(sources.files[0]) : ""
  const referenceObjects = shouldEmitReferenceObjects(options)
  const context = { builtin, opencodeAuth, notices, baseDir, legacy: !referenceObjects }
  if (!referenceObjects && Object.keys(declared).length > 0) {
    notices.push(
      `NOTICE omo: the installed senpi engine does not support {file:...} / {env:...} reference objects yet, so omo imported these providers in the plain-string form and refused any {file:...} reference in them. Update senpi to pick up the reference-object support.`,
    )
  }
  const providers = []
  // The ids declared but not carried; each one's reason is in `notices`.
  const skipped = []
  for (const [id, entry] of Object.entries(declared)) {
    const converted = convertProvider(id, entry, context)
    if (converted) providers.push(converted)
    else skipped.push(id)
  }
  providers.sort((left, right) => left.id.localeCompare(right.id))
  skipped.sort((left, right) => left.localeCompare(right))
  return { providers, skipped, notices }
}
