/**
 * Which task categories the user's providers serve, for `omo doctor` and the `omo setup` summary.
 *
 * The model list is the pinned engine's own: its ModelRuntime, built the way the engine's
 * `auth-check --no-refresh` builds it (read-only credentials, in-memory model cache, no network),
 * so auth.json, models.json custom providers and provider env keys count exactly as a session
 * counts them, and nothing is written. The classification is the spawn path's resolver, reached
 * through the bundled `plugin/runtime/category-coverage/index.js` (category-coverage-entry.ts).
 * Both are fail-open: any error yields no coverage, never a failed command.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { nativePluginRoot, resolveSenpi } from "./package-paths.js"

export const COVERAGE_RUNTIME = join("plugin", "runtime", "category-coverage", "index.js")

async function loadEngine() {
  const core = join(resolveSenpi().packageRoot, "dist", "core")
  const load = (name) => import(pathToFileURL(join(core, name)).href)
  const subscriptionDir = join("extensions", "builtin", "anthropic-subscription")
  const [runtime, auth, store, settings, subscription, subscriptionSettings] = await Promise.all([
    load("model-runtime.js"),
    load("auth-storage.js"),
    load("models-store.js"),
    load("settings-manager.js"),
    load(join(subscriptionDir, "index.js")),
    load(join(subscriptionDir, "settings.js")),
  ])
  return {
    ModelRuntime: runtime.ModelRuntime,
    AuthStorage: auth.AuthStorage,
    ReadOnlyAuthStorage: auth.ReadOnlyAuthStorage,
    InMemoryCodingAgentModelsStore: store.InMemoryCodingAgentModelsStore,
    SettingsManager: settings.SettingsManager,
    registerAnthropicSubscription: subscription.registerAnthropicSubscriptionExtension,
    loadAnthropicSubscriptionSettings: subscriptionSettings.loadAnthropicSubscriptionProviderSettings,
  }
}

// anthropic-subscription is the one chain provider a builtin extension registers instead of the
// catalog. Its registration carries its own availability check (stored accounts,
// CLAUDE_CODE_OAUTH_TOKEN* env tokens, an opted-in ambient Claude login), so the provider config
// is captured from the extension itself and registered on the runtime, as a session does. The
// extension's commands and session hooks are not needed here and are dropped. Its settings are
// read from the inspected agent dir (the extension's default reads the engine's own default dir).
function extensionProviders(register) {
  const providers = []
  const capture = (name, config) => { providers.push([name, config]) }
  register(new Proxy({}, { get: (_, key) => key === "registerProvider" ? capture : () => undefined }))
  return providers
}

async function loadRuntime() {
  return import(pathToFileURL(join(nativePluginRoot(), relative("plugin", COVERAGE_RUNTIME))).href)
}

/**
 * @typedef {{ provider: string, id: string }} EngineModel
 * @typedef {{
 *   agentDir: string,
 *   authEntries?: Record<string, unknown>,
 *   modelsDocument?: Record<string, unknown>,
 *   cwd?: string,
 *   loadEngine?: () => Promise<any>,
 * }} EngineModelsInput
 * @param {EngineModelsInput} input `authEntries` / `modelsDocument` stand in for auth.json /
 *   models.json (a setup plan's post-import view); absent, the agent dir's files are read.
 * @returns {Promise<EngineModel[]>}
 */
export async function engineAvailableModels(input) {
  const engine = await (input.loadEngine ?? loadEngine)()
  const credentials = input.authEntries === undefined
    ? new engine.ReadOnlyAuthStorage(join(input.agentDir, "auth.json"))
    : engine.AuthStorage.inMemory(input.authEntries)
  const scratch = input.modelsDocument === undefined ? undefined : mkdtempSync(join(tmpdir(), "omo-coverage-"))
  try {
    const modelsPath = scratch === undefined ? join(input.agentDir, "models.json") : join(scratch, "models.json")
    if (scratch !== undefined) writeFileSync(modelsPath, JSON.stringify(input.modelsDocument), { mode: 0o600 })
    const runtime = await engine.ModelRuntime.create({
      credentials,
      modelsPath,
      modelsStore: new engine.InMemoryCodingAgentModelsStore(),
      allowModelNetwork: false,
    })
    const cwd = input.cwd ?? process.cwd()
    const readSettings = () => engine.loadAnthropicSubscriptionSettings(engine.SettingsManager.create(cwd, input.agentDir))
    for (const [name, config] of extensionProviders((pi) => engine.registerAnthropicSubscription(pi, { readSettings }))) {
      await runtime.registerProvider(name, config, { refresh: false })
    }
    return (await runtime.getAvailable()).map((model) => ({ provider: model.provider, id: model.id }))
  } finally {
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * @typedef {{ name: string, providers: string[], unlistedProviderModel?: string }} UnusableCategory
 * @typedef {{ usable: string[], unusable: UnusableCategory[] }} CategoryCoverage
 * @typedef {{
 *   models: EngineModel[],
 *   cwd: string,
 *   env: Record<string, string | undefined>,
 *   pinnedCategories?: string[],
 *   loadRuntime?: () => Promise<any>,
 * }} CoverageInput
 * @param {CoverageInput} input
 * @returns {Promise<CategoryCoverage>}
 */
export async function categoryCoverage(input) {
  const runtime = await (input.loadRuntime ?? loadRuntime)()
  return runtime.categoryCoverage({ models: input.models, cwd: input.cwd, env: input.env, pinnedCategories: input.pinnedCategories ?? [] })
}

function total(coverage) {
  return coverage.usable.length + coverage.unusable.length
}

// The category-unavailable notice's wording (omo-senpi components/task/category-unavailable-warning.ts).
function gapLine(gap) {
  if (gap.unlistedProviderModel !== undefined) {
    const gateway = gap.unlistedProviderModel.slice(0, gap.unlistedProviderModel.indexOf("/"))
    return `Category "${gap.name}" is unavailable: only ${gateway}, which its chain does not list, serves its models, and omo never bills a builtin category to an unlisted provider. Connect one of its providers (${gap.providers.join(", ")}) with /login <provider>, or opt in with categories.${gap.name}.model = "${gap.unlistedProviderModel}" in omo.json.`
  }
  if (gap.providers.length === 0) {
    return `Category "${gap.name}" has no usable model: your connected providers serve none of its fallback-chain models. Pin categories.${gap.name}.model in omo.json.`
  }
  return `Category "${gap.name}" has no usable model: none of its fallback-chain providers are connected (${gap.providers.join(", ")}). Connect one with /login <provider>, or pin categories.${gap.name}.model in omo.json.`
}

/** @param {CategoryCoverage} coverage */
export function formatDoctorCoverageLines(coverage) {
  if (coverage.unusable.length === 0) return [`PASS task categories: all ${total(coverage)} usable with your connected providers`]
  const usable = coverage.usable.length > 0 ? ` (${coverage.usable.join(", ")})` : ""
  return [
    `WARN task categories: ${coverage.usable.length} of ${total(coverage)} usable with your connected providers${usable}`,
    ...coverage.unusable.map((gap) => `WARN ${gapLine(gap)}`),
  ]
}

/** The setup summary's `categories` row parts. @param {CategoryCoverage} coverage */
export function coverageSummaryParts(coverage) {
  if (coverage.unusable.length === 0) return [`all ${total(coverage)} usable with these providers`]
  const usable = coverage.usable.length > 0 ? ` (${coverage.usable.join(", ")})` : ""
  return [`${coverage.usable.length} of ${total(coverage)} usable with these providers${usable}`, ...coverage.unusable.map(gapLine)]
}

/**
 * @typedef {{
 *   agentDir: string,
 *   cwd?: string,
 *   env?: Record<string, string | undefined>,
 *   loadEngine?: () => Promise<any>,
 *   loadRuntime?: () => Promise<any>,
 * }} DoctorCoverageOptions
 * @param {DoctorCoverageOptions} options
 * @returns {Promise<string[]>}
 */
export async function doctorCoverageLines(options) {
  try {
    // The runtime first: a payload without it fails fast, before the engine import.
    const runtime = await (options.loadRuntime ?? loadRuntime)()
    const cwd = options.cwd ?? process.cwd()
    const models = await engineAvailableModels({ agentDir: options.agentDir, cwd, loadEngine: options.loadEngine })
    const coverage = await categoryCoverage({ models, cwd, env: options.env ?? process.env, loadRuntime: async () => runtime })
    return formatDoctorCoverageLines(coverage)
  } catch {
    return []
  }
}

/**
 * Coverage for what setup's plan leaves behind: auth.json with the keys the credential and
 * custom-provider stages add, models.json with the providers they add, omo.json with the category
 * pins the model-choice stage writes. Undefined when that view cannot be composed or computed.
 *
 * @typedef {{
 *   agentDir: string,
 *   home: string,
 *   env: Record<string, string | undefined>,
 *   plans: any,
 *   cwd?: string,
 *   loadEngine?: () => Promise<any>,
 *   loadRuntime?: () => Promise<any>,
 * }} SetupCoverageInput
 * @param {SetupCoverageInput} input
 * @returns {Promise<CategoryCoverage | undefined>}
 */
export async function setupCoverage(input) {
  try {
    const { credentials, providers, modelChoices } = input.plans
    if (credentials.malformed || providers.models.malformed) return undefined
    const runtime = await (input.loadRuntime ?? loadRuntime)()
    const authEntries = { ...credentials.current.entries }
    for (const item of [...credentials.result.additions, ...providers.result.keys]) authEntries[item.provider] ??= { type: "api_key", key: item.key }
    const added = providers.result.added
    const modelsDocument = added.length === 0 ? undefined : {
      ...providers.models.document,
      providers: { ...providers.models.document.providers, ...Object.fromEntries(added.map((provider) => [provider.id, provider.config])) },
    }
    const cwd = input.cwd ?? process.cwd()
    const models = await engineAvailableModels({ agentDir: input.agentDir, authEntries, modelsDocument, cwd, loadEngine: input.loadEngine })
    const pinnedCategories = modelChoices.items.filter((item) => item.kind === "categories" && item.state === "pending").map((item) => item.name)
    return await categoryCoverage({
      models,
      cwd,
      env: { ...input.env, HOME: input.home },
      pinnedCategories,
      loadRuntime: async () => runtime,
    })
  } catch {
    return undefined
  }
}
