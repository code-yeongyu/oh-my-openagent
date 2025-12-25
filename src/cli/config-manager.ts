import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ConfigMergeResult, DetectedConfig, InstallConfig } from "./types"

const OPENCODE_CONFIG_DIR = join(homedir(), ".config", "opencode")
const OPENCODE_JSON = join(OPENCODE_CONFIG_DIR, "opencode.json")
const OPENCODE_JSONC = join(OPENCODE_CONFIG_DIR, "opencode.jsonc")
const OPENCODE_PACKAGE_JSON = join(OPENCODE_CONFIG_DIR, "package.json")
const OMO_CONFIG = join(OPENCODE_CONFIG_DIR, "oh-my-opencode.json")

const CHATGPT_HOTFIX_REPO = "code-yeongyu/opencode-openai-codex-auth#fix/orphaned-function-call-output-with-tools"

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

type ConfigFormat = "json" | "jsonc" | "none"

interface OpenCodeConfig {
  plugin?: string[]
  [key: string]: unknown
}

export function detectConfigFormat(): { format: ConfigFormat; path: string } {
  if (existsSync(OPENCODE_JSONC)) {
    return { format: "jsonc", path: OPENCODE_JSONC }
  }
  if (existsSync(OPENCODE_JSON)) {
    return { format: "json", path: OPENCODE_JSON }
  }
  return { format: "none", path: OPENCODE_JSON }
}

function stripJsoncComments(content: string): string {
  let result = ""
  let i = 0
  let inString = false
  let escape = false

  while (i < content.length) {
    const char = content[i]

    if (escape) {
      result += char
      escape = false
      i++
      continue
    }

    if (char === "\\") {
      result += char
      escape = true
      i++
      continue
    }

    if (char === '"' && !inString) {
      inString = true
      result += char
      i++
      continue
    }

    if (char === '"' && inString) {
      inString = false
      result += char
      i++
      continue
    }

    if (inString) {
      result += char
      i++
      continue
    }

    // Outside string - check for comments
    if (char === "/" && content[i + 1] === "/") {
      // Line comment - skip to end of line
      while (i < content.length && content[i] !== "\n") {
        i++
      }
      continue
    }

    if (char === "/" && content[i + 1] === "*") {
      // Block comment - skip to */
      i += 2
      while (i < content.length - 1 && !(content[i] === "*" && content[i + 1] === "/")) {
        i++
      }
      i += 2
      continue
    }

    result += char
    i++
  }

  return result.replace(/,(\s*[}\]])/g, "$1")
}

function parseConfig(path: string, isJsonc: boolean): OpenCodeConfig | null {
  try {
    const content = readFileSync(path, "utf-8")
    const cleaned = isJsonc ? stripJsoncComments(content) : content
    return JSON.parse(cleaned) as OpenCodeConfig
  } catch {
    return null
  }
}

function ensureConfigDir(): void {
  if (!existsSync(OPENCODE_CONFIG_DIR)) {
    mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true })
  }
}

export function addPluginToOpenCodeConfig(): ConfigMergeResult {
  ensureConfigDir()

  const { format, path } = detectConfigFormat()
  const pluginName = "oh-my-opencode"

  try {
    if (format === "none") {
      const config: OpenCodeConfig = { plugin: [pluginName] }
      writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
      return { success: true, configPath: path }
    }

    const config = parseConfig(path, format === "jsonc")
    if (!config) {
      return { success: false, configPath: path, error: "Failed to parse config" }
    }

    const plugins = config.plugin ?? []
    if (plugins.some((p) => p.startsWith(pluginName))) {
      return { success: true, configPath: path }
    }

    config.plugin = [...plugins, pluginName]

    if (format === "jsonc") {
      const content = readFileSync(path, "utf-8")
      const pluginArrayRegex = /"plugin"\s*:\s*\[([\s\S]*?)\]/
      const match = content.match(pluginArrayRegex)

      if (match) {
        const arrayContent = match[1].trim()
        const newArrayContent = arrayContent
          ? `${arrayContent},\n    "${pluginName}"`
          : `"${pluginName}"`
        const newContent = content.replace(pluginArrayRegex, `"plugin": [\n    ${newArrayContent}\n  ]`)
        writeFileSync(path, newContent)
      } else {
        const newContent = content.replace(/^(\s*\{)/, `$1\n  "plugin": ["${pluginName}"],`)
        writeFileSync(path, newContent)
      }
    } else {
      writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
    }

    return { success: true, configPath: path }
  } catch (err) {
    return { success: false, configPath: path, error: String(err) }
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
  const config: Record<string, unknown> = {
    $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  }

  if (installConfig.hasGemini) {
    config.google_auth = false
  }

  const agents: Record<string, Record<string, unknown>> = {}

  if (!installConfig.hasClaude) {
    agents["Sisyphus"] = { model: "opencode/big-pickle" }
    agents["librarian"] = { model: "opencode/big-pickle" }
  } else if (!installConfig.isMax20) {
    agents["librarian"] = { model: "opencode/big-pickle" }
  }

  if (!installConfig.hasChatGPT) {
    agents["oracle"] = {
      model: installConfig.hasClaude ? "anthropic/claude-opus-4-5" : "opencode/big-pickle",
    }
  }

  if (installConfig.hasGemini) {
    agents["frontend-ui-ux-engineer"] = { model: "google/gemini-3-pro-high" }
    agents["document-writer"] = { model: "google/gemini-3-flash" }
    agents["multimodal-looker"] = { model: "google/gemini-3-flash" }
  } else {
    const fallbackModel = installConfig.hasClaude ? "anthropic/claude-opus-4-5" : "opencode/big-pickle"
    agents["frontend-ui-ux-engineer"] = { model: fallbackModel }
    agents["document-writer"] = { model: fallbackModel }
    agents["multimodal-looker"] = { model: fallbackModel }
  }

  if (Object.keys(agents).length > 0) {
    config.agents = agents
  }

  return config
}

export function writeOmoConfig(installConfig: InstallConfig): ConfigMergeResult {
  ensureConfigDir()

  try {
    const newConfig = generateOmoConfig(installConfig)

    if (existsSync(OMO_CONFIG)) {
      const content = readFileSync(OMO_CONFIG, "utf-8")
      const cleaned = stripJsoncComments(content)
      const existing = JSON.parse(cleaned) as Record<string, unknown>
      delete existing.agents
      const merged = deepMerge(existing, newConfig)
      writeFileSync(OMO_CONFIG, JSON.stringify(merged, null, 2) + "\n")
    } else {
      writeFileSync(OMO_CONFIG, JSON.stringify(newConfig, null, 2) + "\n")
    }

    return { success: true, configPath: OMO_CONFIG }
  } catch (err) {
    return { success: false, configPath: OMO_CONFIG, error: String(err) }
  }
}

export async function isOpenCodeInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["opencode", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export async function getOpenCodeVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["opencode", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    return proc.exitCode === 0 ? output.trim() : null
  } catch {
    return null
  }
}

export async function addAuthPlugins(config: InstallConfig): Promise<ConfigMergeResult> {
  ensureConfigDir()
  const { format, path } = detectConfigFormat()

  try {
    const existingConfig = format !== "none" ? parseConfig(path, format === "jsonc") : null
    const plugins: string[] = existingConfig?.plugin ?? []

    if (config.hasGemini) {
      const version = await fetchLatestVersion("opencode-antigravity-auth")
      const pluginEntry = version ? `opencode-antigravity-auth@${version}` : "opencode-antigravity-auth"
      if (!plugins.some((p) => p.startsWith("opencode-antigravity-auth"))) {
        plugins.push(pluginEntry)
      }
    }

    if (config.hasChatGPT) {
      if (!plugins.some((p) => p.startsWith("opencode-openai-codex-auth"))) {
        plugins.push("opencode-openai-codex-auth")
      }
    }

    const newConfig = { ...(existingConfig ?? {}), plugin: plugins }
    writeFileSync(path, JSON.stringify(newConfig, null, 2) + "\n")
    return { success: true, configPath: path }
  } catch (err) {
    return { success: false, configPath: path, error: String(err) }
  }
}

export function setupChatGPTHotfix(): ConfigMergeResult {
  ensureConfigDir()

  try {
    let packageJson: Record<string, unknown> = {}
    if (existsSync(OPENCODE_PACKAGE_JSON)) {
      const content = readFileSync(OPENCODE_PACKAGE_JSON, "utf-8")
      packageJson = JSON.parse(content)
    }

    const deps = (packageJson.dependencies ?? {}) as Record<string, string>
    deps["opencode-openai-codex-auth"] = CHATGPT_HOTFIX_REPO
    packageJson.dependencies = deps

    writeFileSync(OPENCODE_PACKAGE_JSON, JSON.stringify(packageJson, null, 2) + "\n")
    return { success: true, configPath: OPENCODE_PACKAGE_JSON }
  } catch (err) {
    return { success: false, configPath: OPENCODE_PACKAGE_JSON, error: String(err) }
  }
}

export async function runBunInstall(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["bun", "install"], {
      cwd: OPENCODE_CONFIG_DIR,
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export const ANTIGRAVITY_PROVIDER_CONFIG = {
  google: {
    name: "Google",
    // NOTE: opencode-antigravity-auth expects full model specs (name/limit/modalities).
    // If these are incomplete, models may appear but fail at runtime (e.g. 404).
    models: {
      "gemini-3-pro-high": {
        name: "Gemini 3 Pro High (Antigravity)",
        thinking: true,
        attachment: true,
        limit: { context: 1048576, output: 65535 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "gemini-3-pro-medium": {
        name: "Gemini 3 Pro Medium (Antigravity)",
        thinking: true,
        attachment: true,
        limit: { context: 1048576, output: 65535 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "gemini-3-pro-low": {
        name: "Gemini 3 Pro Low (Antigravity)",
        thinking: true,
        attachment: true,
        limit: { context: 1048576, output: 65535 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "gemini-3-flash": {
        name: "Gemini 3 Flash (Antigravity)",
        attachment: true,
        limit: { context: 1048576, output: 65536 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "gemini-3-flash-lite": {
        name: "Gemini 3 Flash Lite (Antigravity)",
        attachment: true,
        limit: { context: 1048576, output: 65536 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
    },
  },
}

const CODEX_PROVIDER_CONFIG = {
  openai: {
    name: "OpenAI",
    api: "codex",
    models: {
      "gpt-5.2": { name: "GPT-5.2" },
      "o3": { name: "o3", thinking: true },
      "o4-mini": { name: "o4-mini", thinking: true },
      "codex-1": { name: "Codex-1" },
    },
  },
}

export function addProviderConfig(config: InstallConfig): ConfigMergeResult {
  ensureConfigDir()
  const { format, path } = detectConfigFormat()

  try {
    const existingConfig = format !== "none" ? parseConfig(path, format === "jsonc") : null
    const newConfig = { ...(existingConfig ?? {}) }

    const providers = (newConfig.provider ?? {}) as Record<string, unknown>

    if (config.hasGemini) {
      providers.google = ANTIGRAVITY_PROVIDER_CONFIG.google
    }

    if (config.hasChatGPT) {
      providers.openai = CODEX_PROVIDER_CONFIG.openai
    }

    if (Object.keys(providers).length > 0) {
      newConfig.provider = providers
    }

    writeFileSync(path, JSON.stringify(newConfig, null, 2) + "\n")
    return { success: true, configPath: path }
  } catch (err) {
    return { success: false, configPath: path, error: String(err) }
  }
}

interface OmoConfigData {
  google_auth?: boolean
  agents?: Record<string, { model?: string }>
}

export function detectCurrentConfig(): DetectedConfig {
  const result: DetectedConfig = {
    isInstalled: false,
    hasClaude: true,
    isMax20: true,
    hasChatGPT: true,
    hasGemini: false,
  }

  const { format, path } = detectConfigFormat()
  if (format === "none") {
    return result
  }

  const openCodeConfig = parseConfig(path, format === "jsonc")
  if (!openCodeConfig) {
    return result
  }

  const plugins = openCodeConfig.plugin ?? []
  result.isInstalled = plugins.some((p) => p.startsWith("oh-my-opencode"))

  if (!result.isInstalled) {
    return result
  }

  result.hasGemini = plugins.some((p) => p.startsWith("opencode-antigravity-auth"))
  result.hasChatGPT = plugins.some((p) => p.startsWith("opencode-openai-codex-auth"))

  if (!existsSync(OMO_CONFIG)) {
    return result
  }

  try {
    const content = readFileSync(OMO_CONFIG, "utf-8")
    const omoConfig = JSON.parse(stripJsoncComments(content)) as OmoConfigData

    const agents = omoConfig.agents ?? {}

    if (agents["Sisyphus"]?.model === "opencode/big-pickle") {
      result.hasClaude = false
      result.isMax20 = false
    } else if (agents["librarian"]?.model === "opencode/big-pickle") {
      result.hasClaude = true
      result.isMax20 = false
    }

    if (agents["oracle"]?.model?.startsWith("anthropic/")) {
      result.hasChatGPT = false
    } else if (agents["oracle"]?.model === "opencode/big-pickle") {
      result.hasChatGPT = false
    }

    if (omoConfig.google_auth === false) {
      result.hasGemini = plugins.some((p) => p.startsWith("opencode-antigravity-auth"))
    }
  } catch {
    /* intentionally empty - malformed config returns defaults */
  }

  return result
}
