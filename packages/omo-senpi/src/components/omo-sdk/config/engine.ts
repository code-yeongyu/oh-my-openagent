import { existsSync, lstatSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir, userInfo } from "node:os"
import { dirname, join, normalize, resolve } from "node:path"

import { resolveAgentHome } from "@oh-my-opencode/senpi-task/agent-home"
import { parseJsoncSafe } from "@oh-my-opencode/utils"

/**
 * The engine version the defaults below and the two behaviour notes were read at. The runtime bundles
 * inline everything except Node builtins, so the SDK keeps this table instead of importing the engine;
 * `engine-defaults.parity.test.ts` holds it equal to the pinned engine's own `SettingsManager`.
 */
export const ENGINE_READ_AT_VERSION = "2026.11.19-3"

/**
 * The engine's project settings directory name under the omo brand: omo launches the engine with
 * `SENPI_BRAND.configDir` `.omo` (omo-native `compiled-environment.ts`), which wins over the engine
 * package's own `piConfig.configDir` (`.senpi`) in its `CONFIG_DIR_NAME`.
 */
export const ENGINE_CONFIG_DIR_NAME = ".omo"

/** The engine's `MAX_PARENT_CONFIG_SEARCH_DEPTH` (`nearest-parent-config.js`). */
const MAX_PARENT_SEARCH_DEPTH = 100

export const ENGINE_DEFAULTS = {
  "compaction.enabled": true,
  "compaction.speculativeEnabled": true,
  "compaction.speculativeFraction": 0.75,
  "compaction.speculativeCooldownMs": 30_000,
  "compaction.idleCompactionEnabled": true,
  "retry.modelFallback": true,
  "retry.fallbackRevertPolicy": "cooldown-expiry",
} as const satisfies Readonly<Record<string, boolean | number | string>>

export type EngineDefaultKey = keyof typeof ENGINE_DEFAULTS

/** The shipped fallback chains, keyed by bare model id; settings chains layer over them per key. */
export const ENGINE_DEFAULT_FALLBACK_CHAINS: Readonly<Record<string, readonly string[]>> = {
  "claude-fable-5-2": ["claude-opus-5-5", "claude-opus-5"],
  "claude-fable-5-1": ["claude-opus-5-5", "claude-opus-5"],
  "claude-fable-5": ["claude-opus-5-5", "claude-opus-5"],
  "claude-opus-5-5": ["claude-fable-5-2:medium", "kimi-k3.1-pro:max"],
}

export const COMPACTION_KEYS = [
  "compaction.enabled",
  "compaction.speculativeEnabled",
  "compaction.speculativeFraction",
  "compaction.speculativeCooldownMs",
  "compaction.idleCompactionEnabled",
] as const

/** Engine behaviours the engine does not export, stated with the version they were read at. */
export const ENGINE_BEHAVIOURS = {
  compactionOffStillSummarizes: { engineIssue: "code-yeongyu/senpi#7074", readAtEngineVersion: ENGINE_READ_AT_VERSION },
  speculativeFractionNoEffect: { engineIssue: "code-yeongyu/senpi#7067", readAtEngineVersion: ENGINE_READ_AT_VERSION },
} as const

export type EngineScope = "global" | "project"

export type EngineSettingsFile = {
  readonly scope: EngineScope
  readonly path: string
  readonly exists: boolean
  readonly loaded: boolean
  readonly diagnostics: readonly string[]
  readonly document: Readonly<Record<string, unknown>>
}

export type EngineLocation = {
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homeDir?: string
}

function accountHomeDir(): string | undefined {
  try {
    return normalize(userInfo().homedir)
  } catch {
    return undefined
  }
}

const ACCOUNT_HOME_DIR = accountHomeDir()

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * The engine's `findNearestParentConfigDir`: the nearest non-symlinked config directory between `cwd` and
 * home, never home itself nor anything above it or above the account's own home; else `<cwd>/<dir>`.
 */
function findProjectSettingsDir(cwd: string, homeDir: string): string {
  const home = normalize(homeDir)
  const stopAtAccountHome = ACCOUNT_HOME_DIR !== undefined && dirname(ACCOUNT_HOME_DIR) !== ACCOUNT_HOME_DIR
  let current = normalize(resolve(cwd))
  for (let depth = 0; depth <= MAX_PARENT_SEARCH_DEPTH; depth += 1) {
    if (current === home || (stopAtAccountHome && current === ACCOUNT_HOME_DIR)) break
    const candidate = join(current, ENGINE_CONFIG_DIR_NAME)
    if (isDirectory(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return join(resolve(cwd), ENGINE_CONFIG_DIR_NAME)
}

function settingsPathIn(directory: string): string {
  const jsonc = join(directory, "settings.jsonc")
  return existsSync(jsonc) ? jsonc : join(directory, "settings.json")
}

export function engineSettingsPath(scope: EngineScope, location: EngineLocation): string {
  const homeDir = location.homeDir ?? location.env.HOME ?? homedir()
  const directory =
    scope === "global"
      ? resolveAgentHome({ env: location.env, homeDir })
      : findProjectSettingsDir(location.cwd, homeDir)
  return settingsPathIn(directory)
}

export function parseEngineSettings(content: string): {
  readonly document: Readonly<Record<string, unknown>>
  readonly diagnostics: readonly string[]
} {
  const parsed = parseJsoncSafe<unknown>(content)
  if (parsed.errors.length > 0) {
    return {
      document: {},
      diagnostics: parsed.errors.map((error) => `parse error ${error.message} at ${error.offset}`),
    }
  }
  const data = parsed.data
  if (data === null || data === undefined) return { document: {}, diagnostics: [] }
  if (typeof data !== "object" || Array.isArray(data)) return { document: {}, diagnostics: ["not a JSON object"] }
  return { document: data as Record<string, unknown>, diagnostics: [] }
}

export function readEngineSettings(scope: EngineScope, location: EngineLocation): EngineSettingsFile {
  const path = engineSettingsPath(scope, location)
  if (!existsSync(path)) return { scope, path, exists: false, loaded: false, diagnostics: [], document: {} }
  const { document, diagnostics } = parseEngineSettings(readFileSync(path, "utf-8"))
  return { scope, path, exists: true, loaded: diagnostics.length === 0, diagnostics, document }
}

export function readEngineLayers(location: EngineLocation): {
  readonly global: EngineSettingsFile
  readonly project: EngineSettingsFile
} {
  return { global: readEngineSettings("global", location), project: readEngineSettings("project", location) }
}

/** The key path of an engine setting; a fallback chain's model id may hold dots, so it stays one segment. */
export function engineKeySegments(key: string): readonly string[] {
  const chains = "retry.fallbackChains."
  return key.startsWith(chains) ? ["retry", "fallbackChains", key.slice(chains.length)] : key.split(".")
}

/** The version of the engine package this process can resolve, if any. */
export function installedEngineVersion(): string | undefined {
  const require = createRequire(import.meta.url)
  for (const modules of require.resolve.paths("@code-yeongyu/senpi/package.json") ?? []) {
    const manifest = join(modules, "@code-yeongyu", "senpi", "package.json")
    if (!existsSync(manifest)) continue
    try {
      const version: unknown = JSON.parse(readFileSync(manifest, "utf-8")).version
      return typeof version === "string" ? version : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

export function valueAt(document: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = document
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

/** The effective value of a dotted engine key: project over global over the default table. */
export function effectiveEngineValue(
  key: string,
  global: Readonly<Record<string, unknown>>,
  project: Readonly<Record<string, unknown>>,
): unknown {
  const path = key.split(".")
  const fromProject = valueAt(project, path)
  if (fromProject !== undefined) return fromProject
  const fromGlobal = valueAt(global, path)
  if (fromGlobal !== undefined) return fromGlobal
  return Object.hasOwn(ENGINE_DEFAULTS, key) ? ENGINE_DEFAULTS[key as EngineDefaultKey] : undefined
}

export type EngineView = {
  readonly modelFallback: boolean
  readonly revertPolicy: "cooldown-expiry" | "never"
  readonly fallbackChains: Readonly<Record<string, readonly string[]>>
  readonly compaction: {
    readonly enabled: boolean
    readonly speculativeEnabled: boolean
    readonly speculativeFraction: number
    readonly speculativeCooldownMs: number
    readonly idleCompactionEnabled: boolean
  }
  /** On unless `speculativeEnabled` is false, whatever `enabled` says (senpi#7074). */
  readonly backgroundSummaries: "on" | "off"
  readonly idleCompaction: "on" | "off"
  /** Both callers pass a lead of at least 8192 tokens, so the fraction branch is never reached (senpi#7067). */
  readonly speculativeFraction: "no_effect"
  readonly behaviours: typeof ENGINE_BEHAVIOURS
  readonly readAtEngineVersion: string
  readonly installedEngineVersion?: string
  /** True when the installed engine is not the version the behaviours were read at. */
  readonly installedEngineDiffers?: boolean
}

const asBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback)
const asNumber = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback)

function fallbackChains(
  global: Readonly<Record<string, unknown>>,
  project: Readonly<Record<string, unknown>>,
): Readonly<Record<string, readonly string[]>> {
  // Settings scopes replace each other wholesale; the resolved map then layers over the defaults per key.
  const configured = valueAt(project, ["retry", "fallbackChains"]) ?? valueAt(global, ["retry", "fallbackChains"])
  const chains: Record<string, readonly string[]> = { ...ENGINE_DEFAULT_FALLBACK_CHAINS }
  if (configured === null || typeof configured !== "object" || Array.isArray(configured)) return chains
  for (const [key, entries] of Object.entries(configured)) {
    if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === "string")) {
      return { ...ENGINE_DEFAULT_FALLBACK_CHAINS }
    }
    chains[key] = [...entries]
  }
  return chains
}

export function engineView(
  global: Readonly<Record<string, unknown>>,
  project: Readonly<Record<string, unknown>>,
  installedEngineVersion?: string,
): EngineView {
  const get = (key: EngineDefaultKey): unknown => effectiveEngineValue(key, global, project)
  const compaction = {
    enabled: asBoolean(get("compaction.enabled"), ENGINE_DEFAULTS["compaction.enabled"]),
    speculativeEnabled: asBoolean(
      get("compaction.speculativeEnabled"),
      ENGINE_DEFAULTS["compaction.speculativeEnabled"],
    ),
    speculativeFraction: asNumber(
      get("compaction.speculativeFraction"),
      ENGINE_DEFAULTS["compaction.speculativeFraction"],
    ),
    speculativeCooldownMs: asNumber(
      get("compaction.speculativeCooldownMs"),
      ENGINE_DEFAULTS["compaction.speculativeCooldownMs"],
    ),
    idleCompactionEnabled: asBoolean(
      get("compaction.idleCompactionEnabled"),
      ENGINE_DEFAULTS["compaction.idleCompactionEnabled"],
    ),
  }
  return {
    modelFallback: asBoolean(get("retry.modelFallback"), ENGINE_DEFAULTS["retry.modelFallback"]),
    revertPolicy: get("retry.fallbackRevertPolicy") === "never" ? "never" : "cooldown-expiry",
    fallbackChains: fallbackChains(global, project),
    compaction,
    backgroundSummaries: compaction.speculativeEnabled ? "on" : "off",
    idleCompaction: compaction.enabled && compaction.idleCompactionEnabled ? "on" : "off",
    speculativeFraction: "no_effect",
    behaviours: ENGINE_BEHAVIOURS,
    readAtEngineVersion: ENGINE_READ_AT_VERSION,
    ...(installedEngineVersion === undefined
      ? {}
      : { installedEngineVersion, installedEngineDiffers: installedEngineVersion !== ENGINE_READ_AT_VERSION }),
  }
}

/** The fallback chain the engine would walk for `model` (`provider/id` or a bare id), if any. */
export function fallbackChainFor(
  chains: Readonly<Record<string, readonly string[]>>,
  model: string,
): readonly string[] | undefined {
  const bare = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model
  const chain = chains[model] ?? chains[bare]
  return chain === undefined || chain.length === 0 ? undefined : chain
}
