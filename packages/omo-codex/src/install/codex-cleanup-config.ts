import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { parseAgentHeaderName, parseHookStateHeaderKey, parsePluginHeaderKey } from "./codex-config-toml-sections"

const MANAGED_MARKETPLACES = ["sisyphuslabs", "lazycodex", "code-yeongyu-codex-plugins"] as const

const LEGACY_MANAGED_CODEX_AGENT_NAMES_TO_PURGE = ["codex-ultrawork-reviewer"] as const

const CURRENT_MANAGED_CODEX_AGENT_NAMES = [
  "explorer",
  "lazycodex-worker-high",
  "lazycodex-worker-low",
  "lazycodex-worker-medium",
  "librarian",
  "metis",
  "momus",
  "plan",
] as const

export const MANAGED_CODEX_AGENT_NAMES = [
  ...LEGACY_MANAGED_CODEX_AGENT_NAMES_TO_PURGE,
  ...CURRENT_MANAGED_CODEX_AGENT_NAMES,
] as const

export function cleanupCodexLightConfigText(config: string): string {
  let nextConfig = config
  for (const marketplace of MANAGED_MARKETPLACES) {
    nextConfig = removeTomlSections(nextConfig, (header) => header === `marketplaces.${marketplace}`)
    nextConfig = removeTomlSections(nextConfig, (header) => isManagedPluginHeader(header, marketplace))
    nextConfig = removeTomlSections(nextConfig, (header) => isManagedHookStateHeader(header, marketplace))
  }
  nextConfig = removeManagedAgentBlocks(nextConfig)
  return nextConfig.replace(/\n{3,}/g, "\n\n")
}

export async function cleanupCodexConfig(configPath: string, now: (() => Date) | undefined): Promise<{
  readonly changed: boolean
  readonly backupPath?: string
}> {
  if (!(await configExists(configPath))) return { changed: false }

  const original = await readFile(configPath, "utf8")
  const next = cleanupCodexLightConfigText(original)
  if (next === original) return { changed: false }

  const backupPath = `${configPath}.backup-${formatBackupTimestamp(now?.() ?? new Date())}`
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(backupPath, original)
  await writeFile(configPath, `${next.trimEnd()}\n`)
  return { changed: true, backupPath }
}

function removeManagedAgentBlocks(config: string): string {
  const managedAgentNames = new Set<string>(MANAGED_CODEX_AGENT_NAMES)
  return splitTomlSections(config)
    .filter((section) => {
      if (section.header === null) return true
      const agentName = parseAgentHeaderName(section.header)
      if (agentName === null || !managedAgentNames.has(agentName)) return true
      return !section.text.includes(`config_file = ${JSON.stringify(`./agents/${agentName}.toml`)}`)
    })
    .map((section) => section.text)
    .join("")
}

function isManagedPluginHeader(header: string, marketplace: string): boolean {
  const pluginKey = parsePluginHeaderKey(header)
  return pluginKey !== null && pluginKey.endsWith(`@${marketplace}`)
}

function isManagedHookStateHeader(header: string, marketplace: string): boolean {
  const hookKey = parseHookStateHeaderKey(header)
  if (hookKey === null) return false
  const separator = hookKey.indexOf(":")
  if (separator === -1) return false
  return hookKey.slice(0, separator).endsWith(`@${marketplace}`)
}

function removeTomlSections(config: string, shouldRemove: (header: string) => boolean): string {
  return splitTomlSections(config)
    .filter((section) => section.header === null || !shouldRemove(section.header))
    .map((section) => section.text)
    .join("")
}

function splitTomlSections(config: string): Array<{ header: string | null; text: string }> {
  const lines = config.match(/[^\n]*\n?|$/g) ?? []
  const sections: Array<{ header: string | null; text: string }> = []
  let current: { header: string | null; text: string } = { header: null, text: "" }
  for (const line of lines) {
    if (line.length === 0) break
    const header = parseTomlHeader(line)
    if (header !== null) {
      if (current.text.length > 0) sections.push(current)
      current = { header, text: line }
    } else {
      current.text += line
    }
  }
  if (current.text.length > 0) sections.push(current)
  return sections
}

function parseTomlHeader(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.startsWith("[[")) return null
  return trimmed.slice(1, -1)
}

function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-")
}

async function configExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return false
    throw error
  }
}

function nodeErrorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null
  return typeof error.code === "string" ? error.code : null
}
