import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import {
  parseJsonc,
  getOpenCodeConfigPaths,
  type OpenCodeBinaryType,
  type OpenCodeConfigPaths,
} from "../shared"
import type { ConfigMergeResult, DetectedConfig, InstallConfig } from "./types"
import { generateModelConfig } from "./model-fallback"

const OPENCODE_BINARIES = ["opencode", "opencode-desktop"] as const

interface ConfigContext {
  binary: OpenCodeBinaryType
  version: string | null
  paths: OpenCodeConfigPaths
}

let configContext: ConfigContext | null = null

export function initConfigContext(binary: OpenCodeBinaryType, version: string | null): void {
  const paths = getOpenCodeConfigPaths({ binary, version })
  configContext = { binary, version, paths }
}

export function getConfigContext(): ConfigContext {
  if (!configContext) {
    const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
    configContext = { binary: "opencode", version: null, paths }
  }
  return configContext
}

export function resetConfigContext(): void {
  configContext = null
}

function getConfigDir(): string {
  return getConfigContext().paths.configDir
}

function getConfigJson(): string {
  return getConfigContext().paths.configJson
}

function getConfigJsonc(): string {
  return getConfigContext().paths.configJsonc
}

function getPackageJson(): string {
  return getConfigContext().paths.packageJson
}

function getOmoConfig(): string {
  return getConfigContext().paths.omoConfig
}

const BUN_INSTALL_TIMEOUT_SECONDS = 60
const BUN_INSTALL_TIMEOUT_MS = BUN_INSTALL_TIMEOUT_SECONDS * 1000

interface NodeError extends Error {
  code?: string
}

function isPermissionError(err: unknown): boolean {
  const nodeErr = err as NodeError
  return nodeErr?.code === "EACCES" || nodeErr?.code === "EPERM"
}

function isFileNotFoundError(err: unknown): boolean {
  const nodeErr = err as NodeError
  return nodeErr?.code === "ENOENT"
}

function formatErrorWithSuggestion(err: unknown, context: string): string {
  if (isPermissionError(err)) {
    return `Permission denied: Cannot ${context}. Try running with elevated permissions or check file ownership.`
  }

  if (isFileNotFoundError(err)) {
    return `File not found while trying to ${context}. The file may have been deleted or moved.`
  }

  if (err instanceof SyntaxError) {
    return `JSON syntax error while trying to ${context}: ${err.message}. Check for missing commas, brackets, or invalid characters.`
  }

  const message = err instanceof Error ? err.message : String(err)

  if (message.includes("ENOSPC")) {
    return `Disk full: Cannot ${context}. Free up disk space and try again.`
  }

  if (message.includes("EROFS")) {
    return `Read-only filesystem: Cannot ${context}. Check if the filesystem is mounted read-only.`
  }

  return `Failed to ${context}: ${message}`
}

export async function fetchLatestVersion(packageName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`)
    if (!res.ok) return null
    const data = await res.json() as { version: string }
    return data.version
  } catch {
    return null
  }
}

interface NpmDistTags {
  latest?: string
  beta?: string
  next?: string
  [tag: string]: string | undefined
}

const NPM_FETCH_TIMEOUT_MS = 5000

export async function fetchNpmDistTags(packageName: string): Promise<NpmDistTags | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/-/package/${packageName}/dist-tags`, {
      signal: AbortSignal.timeout(NPM_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json() as NpmDistTags
    return data
  } catch {
    return null
  }
}

const PACKAGE_NAME = "oh-my-opencode"

const PRIORITIZED_TAGS = ["latest", "beta", "next"] as const

export async function getPluginNameWithVersion(currentVersion: string): Promise<string> {
  const distTags = await fetchNpmDistTags(PACKAGE_NAME)

  if (distTags) {
    const allTags = new Set([...PRIORITIZED_TAGS, ...Object.keys(distTags)])
    for (const tag of allTags) {
      if (distTags[tag] === currentVersion) {
        return `${PACKAGE_NAME}@${tag}`
      }
    }
  }

  return `${PACKAGE_NAME}@${currentVersion}`
}

type ConfigFormat = "json" | "jsonc" | "none"

interface OpenCodeConfig {
  plugin?: string[]
  [key: string]: unknown
}

export function detectConfigFormat(): { format: ConfigFormat; path: string } {
  const configJsonc = getConfigJsonc()
  const configJson = getConfigJson()

  if (existsSync(configJsonc)) {
    return { format: "jsonc", path: configJsonc }
  }
  if (existsSync(configJson)) {
    return { format: "json", path: configJson }
  }
  return { format: "none", path: configJson }
}

interface ParseConfigResult {
  config: OpenCodeConfig | null
  error?: string
}

function isEmptyOrWhitespace(content: string): boolean {
  return content.trim().length === 0
}

function parseConfig(path: string, _isJsonc: boolean): OpenCodeConfig | null {
  const result = parseConfigWithError(path)
  return result.config
}

function parseConfigWithError(path: string): ParseConfigResult {
  try {
    const stat = statSync(path)
    if (stat.size === 0) {
      return { config: null, error: `Config file is empty: ${path}. Delete it or add valid JSON content.` }
    }

    const content = readFileSync(path, "utf-8")

    if (isEmptyOrWhitespace(content)) {
      return { config: null, error: `Config file contains only whitespace: ${path}. Delete it or add valid JSON content.` }
    }

    const config = parseJsonc<OpenCodeConfig>(content)

    if (config === null || config === undefined) {
      return { config: null, error: `Config file parsed to null/undefined: ${path}. Ensure it contains valid JSON.` }
    }

    if (typeof config !== "object" || Array.isArray(config)) {
      return { config: null, error: `Config file must contain a JSON object, not ${Array.isArray(config) ? "an array" : typeof config}: ${path}` }
    }

    return { config }
  } catch (err) {
    return { config: null, error: formatErrorWithSuggestion(err, `parse config file ${path}`) }
  }
}

function ensureConfigDir(): void {
  const configDir = getConfigDir()
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
}

export async function addPluginToOpenCodeConfig(currentVersion: string): Promise<ConfigMergeResult> {
  try {
    ensureConfigDir()
  } catch (err) {
    return { success: false, configPath: getConfigDir(), error: formatErrorWithSuggestion(err, "create config directory") }
  }

  const { format, path } = detectConfigFormat()
  const pluginEntry = await getPluginNameWithVersion(currentVersion)

  try {
    if (format === "none") {
      const config: OpenCodeConfig = { plugin: [pluginEntry] }
      writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
      return { success: true, configPath: path }
    }

    const parseResult = parseConfigWithError(path)
    if (!parseResult.config) {
      return { success: false, configPath: path, error: parseResult.error ?? "Failed to parse config file" }
    }

    const config = parseResult.config
    const plugins = config.plugin ?? []
    const existingIndex = plugins.findIndex((p) => p === PACKAGE_NAME || p.startsWith(`${PACKAGE_NAME}@`))

    if (existingIndex !== -1) {
      if (plugins[existingIndex] === pluginEntry) {
        return { success: true, configPath: path }
      }
      plugins[existingIndex] = pluginEntry
    } else {
      plugins.push(pluginEntry)
    }

    config.plugin = plugins

    if (format === "jsonc") {
      const content = readFileSync(path, "utf-8")
      const pluginArrayRegex = /"plugin"\s*:\s*\[([\s\S]*?)\]/
      const match = content.match(pluginArrayRegex)

      if (match) {
        const formattedPlugins = plugins.map((p) => `"${p}"`).join(",\n    ")
        const newContent = content.replace(pluginArrayRegex, `"plugin": [\n    ${formattedPlugins}\n  ]`)
        writeFileSync(path, newContent)
      } else {
        const newContent = content.replace(/^(\s*\{)/, `$1\n  "plugin": ["${pluginEntry}"],`)
        writeFileSync(path, newContent)
      }
    } else {
      writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
    }

    return { success: true, configPath: path }
  } catch (err) {
    return { success: false, configPath: path, error: formatErrorWithSuggestion(err, "update opencode config") }
  }
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key]
    const targetValue = result[key]

    if (
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T]
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T]
    }
  }

  return result
}

export function generateOmoConfig(installConfig: InstallConfig): Record<string, unknown> {
  return generateModelConfig(installConfig)
}

export function writeOmoConfig(installConfig: InstallConfig): ConfigMergeResult {
  try {
    ensureConfigDir()
  } catch (err) {
    return { success: false, configPath: getConfigDir(), error: formatErrorWithSuggestion(err, "create config directory") }
  }

  const omoConfigPath = getOmoConfig()

  try {
    const newConfig = generateOmoConfig(installConfig)

    if (existsSync(omoConfigPath)) {
      try {
        const stat = statSync(omoConfigPath)
        const content = readFileSync(omoConfigPath, "utf-8")

        if (stat.size === 0 || isEmptyOrWhitespace(content)) {
          writeFileSync(omoConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
          return { success: true, configPath: omoConfigPath }
        }

        const existing = parseJsonc<Record<string, unknown>>(content)
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
          writeFileSync(omoConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
          return { success: true, configPath: omoConfigPath }
        }

        const merged = deepMerge(existing, newConfig)
        writeFileSync(omoConfigPath, JSON.stringify(merged, null, 2) + "\n")
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) {
          writeFileSync(omoConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
          return { success: true, configPath: omoConfigPath }
        }
        throw parseErr
      }
    } else {
      writeFileSync(omoConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
    }

    return { success: true, configPath: omoConfigPath }
  } catch (err) {
    return { success: false, configPath: omoConfigPath, error: formatErrorWithSuggestion(err, "write oh-my-opencode config") }
  }
}

interface OpenCodeBinaryResult {
  binary: OpenCodeBinaryType
  version: string
}

async function findOpenCodeBinaryWithVersion(): Promise<OpenCodeBinaryResult | null> {
  for (const binary of OPENCODE_BINARIES) {
    try {
      const proc = Bun.spawn([binary, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const output = await new Response(proc.stdout).text()
      await proc.exited
      if (proc.exitCode === 0) {
        const version = output.trim()
        initConfigContext(binary, version)
        return { binary, version }
      }
    } catch {
      continue
    }
  }
  return null
}

export async function isOpenCodeInstalled(): Promise<boolean> {
  const result = await findOpenCodeBinaryWithVersion()
  return result !== null
}

export async function getOpenCodeVersion(): Promise<string | null> {
  const result = await findOpenCodeBinaryWithVersion()
  return result?.version ?? null
}

export async function addAuthPlugins(config: InstallConfig): Promise<ConfigMergeResult> {
  try {
    ensureConfigDir()
  } catch (err) {
    return { success: false, configPath: getConfigDir(), error: formatErrorWithSuggestion(err, "create config directory") }
  }

  const { format, path } = detectConfigFormat()

  try {
    let existingConfig: OpenCodeConfig | null = null
    if (format !== "none") {
      const parseResult = parseConfigWithError(path)
      if (parseResult.error && !parseResult.config) {
        existingConfig = {}
      } else {
        existingConfig = parseResult.config
      }
    }

    const plugins: string[] = existingConfig?.plugin ?? []

    if (config.hasGemini) {
      const version = await fetchLatestVersion("opencode-antigravity-auth")
      const pluginEntry = version ? `opencode-antigravity-auth@${version}` : "opencode-antigravity-auth"
      if (!plugins.some((p) => p.startsWith("opencode-antigravity-auth"))) {
        plugins.push(pluginEntry)
      }
    }



    const newConfig = { ...(existingConfig ?? {}), plugin: plugins }
    writeFileSync(path, JSON.stringify(newConfig, null, 2) + "\n")
    return { success: true, configPath: path }
  } catch (err) {
    return { success: false, configPath: path, error: formatErrorWithSuggestion(err, "add auth plugins to config") }
  }
}

export interface BunInstallResult {
  success: boolean
  timedOut?: boolean
  error?: string
}

export async function runBunInstall(): Promise<boolean> {
  const result = await runBunInstallWithDetails()
  return result.success
}

export async function runBunInstallWithDetails(): Promise<BunInstallResult> {
  try {
    const proc = Bun.spawn(["bun", "install"], {
      cwd: getConfigDir(),
      stdout: "pipe",
      stderr: "pipe",
    })

    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), BUN_INSTALL_TIMEOUT_MS)
    )

    const exitPromise = proc.exited.then(() => "completed" as const)

    const result = await Promise.race([exitPromise, timeoutPromise])

    if (result === "timeout") {
      try {
        proc.kill()
      } catch {
        /* intentionally empty - process may have already exited */
      }
      return {
        success: false,
        timedOut: true,
        error: `bun install timed out after ${BUN_INSTALL_TIMEOUT_SECONDS} seconds. Try running manually: cd ~/.config/opencode && bun i`,
      }
    }

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      return {
        success: false,
        error: stderr.trim() || `bun install failed with exit code ${proc.exitCode}`,
      }
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `bun install failed: ${message}. Is bun installed? Try: curl -fsSL https://bun.sh/install | bash`,
    }
  }
}

/**
 * Antigravity Provider Configuration
 *
 * IMPORTANT: Model names MUST use `antigravity-` prefix for stability.
 *
 * Since opencode-antigravity-auth v1.3.0, models use a variant system:
 * - `antigravity-gemini-3-pro` with variants: low, high
 * - `antigravity-gemini-3-flash` with variants: minimal, low, medium, high
 *
 * Legacy tier-suffixed names (e.g., `antigravity-gemini-3-pro-high`) still work
 * but variants are the recommended approach.
 *
 * @see https://github.com/NoeFabris/opencode-antigravity-auth#models
 */
export const ANTIGRAVITY_PROVIDER_CONFIG = {
  google: {
    name: "Google",
    models: {
      "antigravity-gemini-3-pro": {
        name: "Gemini 3 Pro (Antigravity)",
        limit: { context: 1048576, output: 65535 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        variants: {
          low: { thinkingLevel: "low" },
          high: { thinkingLevel: "high" },
        },
      },
      "antigravity-gemini-3-flash": {
        name: "Gemini 3 Flash (Antigravity)",
        limit: { context: 1048576, output: 65536 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        variants: {
          minimal: { thinkingLevel: "minimal" },
          low: { thinkingLevel: "low" },
          medium: { thinkingLevel: "medium" },
          high: { thinkingLevel: "high" },
        },
      },
      "antigravity-claude-sonnet-4-5": {
        name: "Claude Sonnet 4.5 (Antigravity)",
        limit: { context: 200000, output: 64000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "antigravity-claude-sonnet-4-5-thinking": {
        name: "Claude Sonnet 4.5 Thinking (Antigravity)",
        limit: { context: 200000, output: 64000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        variants: {
          low: { thinkingConfig: { thinkingBudget: 8192 } },
          max: { thinkingConfig: { thinkingBudget: 32768 } },
        },
      },
      "antigravity-claude-opus-4-5-thinking": {
        name: "Claude Opus 4.5 Thinking (Antigravity)",
        limit: { context: 200000, output: 64000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        variants: {
          low: { thinkingConfig: { thinkingBudget: 8192 } },
          max: { thinkingConfig: { thinkingBudget: 32768 } },
        },
      },
    },
  },
}



export function addProviderConfig(config: InstallConfig): ConfigMergeResult {
  try {
    ensureConfigDir()
  } catch (err) {
    return { success: false, configPath: getConfigDir(), error: formatErrorWithSuggestion(err, "create config directory") }
  }

  const { format, path } = detectConfigFormat()

  try {
    let existingConfig: OpenCodeConfig | null = null
    if (format !== "none") {
      const parseResult = parseConfigWithError(path)
      if (parseResult.error && !parseResult.config) {
        existingConfig = {}
      } else {
        existingConfig = parseResult.config
      }
    }

    const newConfig = { ...(existingConfig ?? {}) }

    const providers = (newConfig.provider ?? {}) as Record<string, unknown>

    if (config.hasGemini) {
      providers.google = ANTIGRAVITY_PROVIDER_CONFIG.google
    }

    if (Object.keys(providers).length > 0) {
      newConfig.provider = providers
    }

    writeFileSync(path, JSON.stringify(newConfig, null, 2) + "\n")
    return { success: true, configPath: path }
  } catch (err) {
    return { success: false, configPath: path, error: formatErrorWithSuggestion(err, "add provider config") }
  }
}

function detectProvidersFromOmoConfig(): { hasOpenAI: boolean; hasOpencodeZen: boolean; hasZaiCodingPlan: boolean; hasKimiForCoding: boolean } {
  const omoConfigPath = getOmoConfig()
  if (!existsSync(omoConfigPath)) {
    return { hasOpenAI: true, hasOpencodeZen: true, hasZaiCodingPlan: false, hasKimiForCoding: false }
  }

  try {
    const content = readFileSync(omoConfigPath, "utf-8")
    const omoConfig = parseJsonc<Record<string, unknown>>(content)
    if (!omoConfig || typeof omoConfig !== "object") {
      return { hasOpenAI: true, hasOpencodeZen: true, hasZaiCodingPlan: false, hasKimiForCoding: false }
    }

    const configStr = JSON.stringify(omoConfig)
    const hasOpenAI = configStr.includes('"openai/')
    const hasOpencodeZen = configStr.includes('"opencode/')
    const hasZaiCodingPlan = configStr.includes('"zai-coding-plan/')
    const hasKimiForCoding = configStr.includes('"kimi-for-coding/')

    return { hasOpenAI, hasOpencodeZen, hasZaiCodingPlan, hasKimiForCoding }
  } catch {
    return { hasOpenAI: true, hasOpencodeZen: true, hasZaiCodingPlan: false, hasKimiForCoding: false }
  }
}

export function detectCurrentConfig(): DetectedConfig {
  const result: DetectedConfig = {
    isInstalled: false,
    hasClaude: true,
    isMax20: true,
    hasOpenAI: true,
    hasGemini: false,
    hasCopilot: false,
    hasOpencodeZen: true,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
  }

  const { format, path } = detectConfigFormat()
  if (format === "none") {
    return result
  }

  const parseResult = parseConfigWithError(path)
  if (!parseResult.config) {
    return result
  }

  const openCodeConfig = parseResult.config
  const plugins = openCodeConfig.plugin ?? []
  result.isInstalled = plugins.some((p) => p.startsWith("oh-my-opencode"))

  if (!result.isInstalled) {
    return result
  }

  // Gemini auth plugin detection still works via plugin presence
  result.hasGemini = plugins.some((p) => p.startsWith("opencode-antigravity-auth"))

  const { hasOpenAI, hasOpencodeZen, hasZaiCodingPlan, hasKimiForCoding } = detectProvidersFromOmoConfig()
  result.hasOpenAI = hasOpenAI
  result.hasOpencodeZen = hasOpencodeZen
  result.hasZaiCodingPlan = hasZaiCodingPlan
  result.hasKimiForCoding = hasKimiForCoding

  return result
}
