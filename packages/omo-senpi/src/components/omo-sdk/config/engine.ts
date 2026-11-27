import { existsSync, lstatSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir, userInfo } from "node:os"
import { dirname, join, normalize, resolve } from "node:path"

import { resolveAgentHome } from "@oh-my-opencode/senpi-task/agent-home"
import { parseJsoncSafe } from "@oh-my-opencode/utils"

import { ENGINE_DEFAULT_FALLBACK_CHAINS } from "./engine-fallback-chains"

/**
 * The engine version the two behaviour notes below were read at. The runtime bundles inline everything except Node
 * builtins, so the SDK keeps its own defaults table instead of importing the engine; `engine-defaults.parity.test.ts`
 * holds the table equal to the pinned engine's own `SettingsManager`.
 */
export const ENGINE_READ_AT_VERSION = "2026.11.19-5"

/**
 * The engine's project settings directory name under the omo brand: omo launches the engine with
 * `SENPI_BRAND.configDir` `.omo` (omo-native `compiled-environment.ts`), which wins over the engine
 * package's own `piConfig.configDir` (`.senpi`) in its `CONFIG_DIR_NAME`.
 */
const ENGINE_CONFIG_DIR_NAME = ".omo"

/** The engine's `MAX_PARENT_CONFIG_SEARCH_DEPTH` (`nearest-parent-config.js`). */
const MAX_PARENT_SEARCH_DEPTH = 100

export const REVERT_POLICIES = ["cooldown-expiry", "never"] as const

/** The typed engine settings the SDK reports, with the engine's defaults; a default's type is the setting's type. */
export const ENGINE_DEFAULTS = {
  "compaction.enabled": true,
  "compaction.speculativeEnabled": true,
  "compaction.speculativeFraction": 0.75,
  "compaction.speculativeCooldownMs": 30_000,
  "compaction.idleCompactionEnabled": true,
  "compaction.reserveTokens": 16_384,
  "compaction.keepRecentTokens": 20_000,
  "retry.modelFallback": true,
  "retry.fallbackRevertPolicy": "cooldown-expiry",
} as const satisfies Readonly<Record<string, boolean | number | (typeof REVERT_POLICIES)[number]>>

export type EngineDefaultKey = keyof typeof ENGINE_DEFAULTS

/** Engine behaviours the engine does not export, stated with the version they were read at. */
export const ENGINE_BEHAVIOURS = {
  compactionOffStillSummarizes: { engineIssue: "code-yeongyu/senpi#7074", readAtEngineVersion: ENGINE_READ_AT_VERSION },
  speculativeFractionNoEffect: { engineIssue: "code-yeongyu/senpi#7067", readAtEngineVersion: ENGINE_READ_AT_VERSION },
} as const

export type EngineScope = "global" | "project"
type Doc = Readonly<Record<string, unknown>>

/** One engine settings file as the SDK reads it; its path and parse text stay inside the SDK. */
type EngineSettingsFile = { readonly scope: EngineScope; readonly exists: boolean; readonly document: Doc }

export type EngineLocation = { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> }

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

function readEngineSettings(scope: EngineScope, location: EngineLocation): EngineSettingsFile {
  const homeDir = location.env["HOME"] ?? homedir()
  const directory =
    scope === "global"
      ? resolveAgentHome({ env: location.env, homeDir })
      : findProjectSettingsDir(location.cwd, homeDir)
  const path = settingsPathIn(directory)
  if (!existsSync(path)) return { scope, exists: false, document: {} }
  const parsed = parseJsoncSafe<unknown>(readFileSync(path, "utf-8"))
  const data = parsed.errors.length === 0 ? parsed.data : undefined
  return { scope, exists: true, document: isRecord(data) ? data : {} }
}

export function readEngineLayers(location: EngineLocation): {
  readonly global: EngineSettingsFile
  readonly project: EngineSettingsFile
} {
  return { global: readEngineSettings("global", location), project: readEngineSettings("project", location) }
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

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The value at `path` through own properties only, so no key walks into a prototype. */
export function valueAt(document: unknown, path: readonly string[]): unknown {
  let current: unknown = document
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Whether `value` has the type of the setting's default (a finite number, a boolean, one of the enum's values). */
export function isEngineSettingValue(key: EngineDefaultKey, value: unknown): boolean {
  const fallback = ENGINE_DEFAULTS[key]
  if (typeof fallback === "number") return typeof value === "number" && Number.isFinite(value)
  if (typeof fallback === "boolean") return typeof value === "boolean"
  return REVERT_POLICIES.some((policy) => policy === value)
}

const isChain = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")

/** Settings scopes replace the chain map wholesale; the resolved map then layers over the defaults per key. */
export function resolvedChains(global: Doc, project: Doc): Readonly<Record<string, readonly string[]>> {
  const configured = valueAt(project, ["retry", "fallbackChains"]) ?? valueAt(global, ["retry", "fallbackChains"])
  if (!isRecord(configured) || !Object.values(configured).every(isChain)) return { ...ENGINE_DEFAULT_FALLBACK_CHAINS }
  return { ...ENGINE_DEFAULT_FALLBACK_CHAINS, ...(configured as Record<string, readonly string[]>) }
}

export type EngineView = {
  readonly compaction: {
    readonly enabled: boolean
    readonly speculativeEnabled: boolean
    readonly speculativeFraction: number
    readonly speculativeCooldownMs: number
    readonly idleCompactionEnabled: boolean
    readonly reserveTokens: number
    readonly keepRecentTokens: number
  }
  readonly retry: {
    readonly modelFallback: boolean
    readonly fallbackRevertPolicy: (typeof REVERT_POLICIES)[number]
    /** Keyed by model id; inside the SDK every chain, before the status answer gates the ids. */
    readonly fallbackChains: Readonly<Record<string, readonly string[]>>
  }
  readonly readAtEngineVersion: string
}

/** The effective engine settings: per key, project over global over the default, a mistyped value as the default. */
export function engineView(global: Doc, project: Doc): EngineView {
  const get = <K extends EngineDefaultKey>(key: K): (typeof ENGINE_DEFAULTS)[K] => {
    const path = key.split(".")
    const value = valueAt(project, path) ?? valueAt(global, path)
    return isEngineSettingValue(key, value) ? (value as (typeof ENGINE_DEFAULTS)[K]) : ENGINE_DEFAULTS[key]
  }
  return {
    compaction: {
      enabled: get("compaction.enabled"),
      speculativeEnabled: get("compaction.speculativeEnabled"),
      speculativeFraction: get("compaction.speculativeFraction"),
      speculativeCooldownMs: get("compaction.speculativeCooldownMs"),
      idleCompactionEnabled: get("compaction.idleCompactionEnabled"),
      reserveTokens: get("compaction.reserveTokens"),
      keepRecentTokens: get("compaction.keepRecentTokens"),
    },
    retry: {
      modelFallback: get("retry.modelFallback"),
      fallbackRevertPolicy: get("retry.fallbackRevertPolicy"),
      fallbackChains: resolvedChains(global, project),
    },
    readAtEngineVersion: ENGINE_READ_AT_VERSION,
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
