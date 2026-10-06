/**
 * Reads the custom providers (`provider.<id>` blocks) of the OpenCode user-scope config - the same
 * merged files the MCP reader uses - and converts each one into the provider entry the engine's
 * `models.json` accepts, plus the API key to store for it. Read-only: nothing here writes.
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { literalConfigValue } from "./auth-store.js"
import { convertPlaceholders, opencodeConfigSources, readOpencodeSection, unconvertedPlaceholder } from "./setup-opencode-assets.js"
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
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

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

// The engine resolves api keys and header values as config values: literal bytes are escaped, and
// OpenCode's `{env:NAME}` becomes the engine's `${NAME}`. Undefined when a placeholder is left that
// the engine has no spelling for (`{file:...}`, a non-identifier `{env:...}`).
function configValue(value) {
  const converted = convertPlaceholders(literalConfigValue(value))
  return unconvertedPlaceholder(converted) ? undefined : converted
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
function convertKey(id, entry, opencodeAuth, notices) {
  const inline = text(entry.options?.apiKey)
  if (inline !== undefined) {
    const key = configValue(inline)
    if (key !== undefined) return { key, source: "opencode config apiKey" }
    notices.push(`NOTICE opencode: custom provider ${id} apiKey uses a {file:...} or {env:...} placeholder omo cannot express; its key was not imported - start omo and run /login ${id}`)
    return undefined
  }
  const stored = opencodeAuth[id]
  if (stored?.type === "api" && text(stored.key) !== undefined) return { key: literalConfigValue(stored.key), source: "opencode auth.json" }
  const names = Array.isArray(entry.env) ? entry.env : []
  if (names.length === 1 && ENV_NAME.test(names[0])) return { key: `\${${names[0]}}`, source: `environment variable ${names[0]}` }
  return undefined
}

// A URL still holding a placeholder has no engine spelling: the engine sends baseUrl verbatim, while
// OpenCode substitutes `{env:...}` / `{file:...}` into its config and `${NAME}` into the URL itself.
function fixedUrl(value) {
  return value !== undefined && !/\{(?:env|file):|\$\{/.test(value) ? value : undefined
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
  const baseURL = provider.optionsBaseURL ?? text(source.provider?.api) ?? provider.baseURL
  const baseUrl = fixedUrl(baseURL) === undefined ? undefined : engineBaseUrl(api, baseURL)
  if (baseUrl === undefined) {
    notices.push(`NOTICE opencode: model ${provider.id}/${id} baseURL ${baseURL} is not a fixed URL omo's ${api} client can use; not imported`)
    return undefined
  }
  const input = Array.isArray(source.modalities?.input) ? source.modalities.input.filter((kind) => MODEL_INPUTS.has(kind)) : []
  return {
    id,
    // OpenCode's model `id` is the id sent to the API when the key is an alias; the engine's
    // `upstreamModelId` replaces the request model id the same way (model-runtime.js).
    ...(text(source.id) !== undefined && source.id !== id ? { upstreamModelId: source.id } : {}),
    ...(text(source.name) !== undefined ? { name: source.name } : {}),
    ...(api !== provider.api ? { api } : {}),
    ...(baseUrl !== provider.baseUrl ? { baseUrl } : {}),
    ...(typeof source.reasoning === "boolean" ? { reasoning: source.reasoning } : {}),
    ...(input.length > 0 ? { input } : {}),
    ...(positive(source.limit?.context) !== undefined ? { contextWindow: source.limit.context } : {}),
    ...(positive(source.limit?.output) !== undefined ? { maxTokens: source.limit.output } : {}),
  }
}

function convertHeaders(headers) {
  if (!isPlainObject(headers)) return {}
  const converted = {}
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== "string") continue
    const resolved = configValue(value)
    if (resolved === undefined) return undefined
    converted[name] = resolved
  }
  return converted
}

function convertProvider(id, entry, context) {
  const { notices } = context
  if (context.builtin.has(id)) {
    notices.push(`NOTICE opencode: provider ${id} is one omo already serves; its opencode overrides (baseURL, models) are not imported - set them in models.json by hand if you need them`)
    return undefined
  }
  if (!isPlainObject(entry)) return undefined
  const npm = text(entry.npm) ?? DEFAULT_NPM
  const api = API_BY_NPM[npm]
  if (api === undefined) {
    notices.push(`NOTICE opencode: custom provider ${id} uses npm package ${npm}, which omo has no API adapter for; not imported`)
    return undefined
  }
  const baseURL = text(entry.options?.baseURL) ?? text(entry.api)
  if (fixedUrl(baseURL) === undefined) {
    notices.push(`NOTICE opencode: custom provider ${id} has no fixed baseURL; not imported - omo needs a literal endpoint URL`)
    return undefined
  }
  const baseUrl = engineBaseUrl(api, baseURL)
  if (baseUrl === undefined) {
    notices.push(`NOTICE opencode: custom provider ${id} baseURL ${baseURL} does not end in /v1, which omo's Anthropic client needs; not imported`)
    return undefined
  }
  const headers = convertHeaders(entry.options?.headers)
  if (headers === undefined) {
    notices.push(`NOTICE opencode: custom provider ${id} has a header with a {file:...} or {env:...} placeholder omo cannot express; not imported`)
    return undefined
  }
  const models = Object.entries(isPlainObject(entry.models) ? entry.models : {})
    .map(([modelId, model]) => convertModel({ id, api, baseURL, baseUrl, optionsBaseURL: text(entry.options?.baseURL) }, modelId, model, notices))
    .filter((model) => model !== undefined)
  if (models.length === 0) {
    notices.push(`NOTICE opencode: custom provider ${id} declares no models omo can use; not imported`)
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
  return { id, npm, config, key: convertKey(id, entry, context.opencodeAuth, notices) }
}

/** Every OpenCode custom provider the engine can serve, converted; everything else as a notice. */
export function planOpencodeProviders(options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const notices = []
  const declared = readOpencodeSection(opencodeConfigSources(home, env).files, "provider", "custom providers", notices)
  // auth.json is only a key source here; with no provider block it is the credential stage's alone.
  if (Object.keys(declared).length === 0) return { providers: [], skipped: [], notices }
  const context = { builtin: builtinProviderIds(), opencodeAuth: readOpencodeAuth(home, env, notices), notices }
  const providers = []
  // The ids declared but not carried; each one's reason is in `notices`.
  const skipped = []
  for (const [id, entry] of Object.entries(declared)) {
    const converted = convertProvider(id, entry, context)
    if (converted) providers.push(converted)
    else skipped.push(id)
  }
  return { providers: providers.sort((left, right) => left.id.localeCompare(right.id)), skipped: skipped.sort(), notices }
}
