import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { purgeRetiredManagedAgentFiles } from "./retired-managed-agent-purge"

const MANIFEST_FILE = ".installed-agents.json"
const AGENT_INSTALL_MANIFEST_FILE = "native-agents.json"

interface AgentInstallManifestEntry {
  readonly sha256: string
}

interface AgentInstallManifest {
  readonly version: 1
  readonly files: Record<string, AgentInstallManifestEntry>
}

interface ManagedAgentTomlWrite {
  readonly fileName: string
  readonly linkPath: string
  readonly manifest: AgentInstallManifest
  readonly target: string
}

export interface LinkedAgent {
  readonly name: string
  readonly path: string
  readonly target: string
}

type LinkPlatform = NodeJS.Platform

export async function capturePreservedAgentReasoning(input: {
  readonly codexHome: string
}): Promise<ReadonlyMap<string, string>> {
  const agentsDir = join(input.codexHome, "agents")
  if (!(await exists(agentsDir))) return new Map()

  const preserved = new Map<string, string>()
  const agentEntries = await readdir(agentsDir, { withFileTypes: true })
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml")) continue
    const content = await readTextIfExists(join(agentsDir, entry.name))
    if (content === null) continue
    const effort = extractReasoningEffort(content)
    if (effort !== null) preserved.set(agentNameFromToml(entry.name), effort)
  }
  return preserved
}

export async function capturePreservedAgentServiceTier(input: {
  readonly codexHome: string
}): Promise<ReadonlyMap<string, string | null>> {
  const agentsDir = join(input.codexHome, "agents")
  if (!(await exists(agentsDir))) return new Map()

  const preserved = new Map<string, string | null>()
  const agentEntries = await readdir(agentsDir, { withFileTypes: true })
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml")) continue
    const content = await readTextIfExists(join(agentsDir, entry.name))
    if (content === null) continue
    preserved.set(agentNameFromToml(entry.name), extractServiceTier(content))
  }
  return preserved
}

export async function linkCachedPluginAgents(input: {
  readonly codexHome: string
  readonly pluginRoot: string
  readonly platform?: LinkPlatform
  readonly preservedReasoning?: ReadonlyMap<string, string>
  readonly preservedServiceTier?: ReadonlyMap<string, string | null>
}): Promise<readonly LinkedAgent[]> {
  const bundledAgents = await discoverBundledAgents(input.pluginRoot)
  await purgeRetiredManagedAgentFiles({ codexHome: input.codexHome })
  if (bundledAgents.length === 0) {
    await writeManifest(input.pluginRoot, [])
    return []
  }
  const agentsDir = join(input.codexHome, "agents")
  await mkdir(agentsDir, { recursive: true })
  const agentInstallManifest = await readAgentInstallManifest(input.codexHome)
  const linked: LinkedAgent[] = []
  for (const agentPath of bundledAgents) {
    const agentFileName = basename(agentPath)
    const linkPath = join(agentsDir, agentFileName)
    await writeManagedAgentToml({
      fileName: agentFileName,
      linkPath,
      manifest: agentInstallManifest,
      target: agentPath,
    })
    linked.push({ name: agentFileName, path: linkPath, target: agentPath })
  }
  await writeManifest(
    input.pluginRoot,
    linked.map((entry) => entry.path),
  )
  await writeAgentInstallManifest(input.codexHome, agentInstallManifest)
  return linked
}

async function discoverBundledAgents(pluginRoot: string): Promise<readonly string[]> {
  const componentsRoot = join(pluginRoot, "components")
  if (!(await exists(componentsRoot))) return []
  const componentEntries = await readdir(componentsRoot, { withFileTypes: true })
  const agents: string[] = []
  for (const entry of componentEntries) {
    if (!entry.isDirectory()) continue
    const agentsRoot = join(componentsRoot, entry.name, "agents")
    if (!(await exists(agentsRoot))) continue
    const agentEntries = await readdir(agentsRoot, { withFileTypes: true })
    for (const file of agentEntries) {
      if (!file.isFile() || !file.name.endsWith(".toml")) continue
      agents.push(join(agentsRoot, file.name))
    }
  }
  agents.sort()
  return agents
}

async function replaceWithContent(linkPath: string, content: string): Promise<void> {
  await prepareReplacement(linkPath)
  await writeFile(linkPath, content)
}

async function prepareReplacement(linkPath: string): Promise<void> {
  if (!(await exists(linkPath))) return
  const entryStat = await lstat(linkPath)
  if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
    throw new Error(`${linkPath} already exists and is a directory; refusing to replace`)
  }
  await rm(linkPath, { force: true })
}

async function writeManifest(pluginRoot: string, agentPaths: readonly string[]): Promise<void> {
  const manifestPath = join(pluginRoot, MANIFEST_FILE)
  const payload = { agents: [...agentPaths].sort() }
  await writeFile(manifestPath, `${JSON.stringify(payload, null, "\t")}\n`)
}

async function writeManagedAgentToml(input: ManagedAgentTomlWrite): Promise<void> {
  const bundledContent = await readFile(input.target, "utf8")
  const bundledHash = hashContent(bundledContent)
  const existingContent = await readTextIfExists(input.linkPath)

  if (existingContent === bundledContent) {
    input.manifest.files[input.fileName] = { sha256: bundledHash }
    return
  }

  if (existingContent !== null) {
    const previousHash = input.manifest.files[input.fileName]?.sha256
    const existingAgentName = extractAgentName(existingContent)
    if (previousHash !== hashContent(existingContent) && existingAgentName === agentNameFromToml(input.fileName)) {
      return
    }
  }

  await replaceWithContent(input.linkPath, bundledContent)
  input.manifest.files[input.fileName] = { sha256: bundledHash }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function agentInstallManifestPath(codexHome: string): string {
  return join(codexHome, ".omo", AGENT_INSTALL_MANIFEST_FILE)
}

async function readAgentInstallManifest(codexHome: string): Promise<AgentInstallManifest> {
  const content = await readTextIfExists(agentInstallManifestPath(codexHome))
  if (content === null) return { version: 1, files: {} }

  try {
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed) || parsed["version"] !== 1 || !isRecord(parsed["files"])) {
      return { version: 1, files: {} }
    }

    const files: Record<string, AgentInstallManifestEntry> = {}
    for (const [fileName, entry] of Object.entries(parsed["files"])) {
      if (!fileName.endsWith(".toml") || !isRecord(entry)) continue
      const sha256 = entry["sha256"]
      if (typeof sha256 === "string" && /^[0-9a-f]{64}$/i.test(sha256)) {
        files[fileName] = { sha256: sha256.toLowerCase() }
      }
    }
    return { version: 1, files }
  } catch (error) {
    if (error instanceof SyntaxError) return { version: 1, files: {} }
    throw error
  }
}

async function writeAgentInstallManifest(codexHome: string, manifest: AgentInstallManifest): Promise<void> {
  const manifestPath = agentInstallManifestPath(codexHome)
  await mkdir(dirname(manifestPath), { recursive: true })

  const files: Record<string, AgentInstallManifestEntry> = {}
  for (const fileName of Object.keys(manifest.files).sort()) {
    const entry = manifest.files[fileName]
    if (entry !== undefined) files[fileName] = entry
  }

  await writeFile(manifestPath, `${JSON.stringify({ version: 1, files }, null, 2)}\n`)
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null
    throw error
  }
}

function extractReasoningEffort(content: string): string | null {
  return extractTopLevelStringSetting(content, "model_reasoning_effort")
}

function extractServiceTier(content: string): string | null {
  return extractTopLevelStringSetting(content, "service_tier")
}

function extractAgentName(content: string): string | null {
  return extractTopLevelStringSetting(content, "name")
}

function extractTopLevelStringSetting(content: string, key: string): string | null {
  for (const line of content.split(/\n/)) {
    if (isSectionHeader(line)) return null
    const rawValue = topLevelStringSettingRawValue(line, key)
    if (rawValue === undefined) continue
    const parsed = parseJsonString(rawValue)
    if (parsed !== null) return parsed
  }
  return null
}

function topLevelStringSettingRawValue(line: string, key: string): string | undefined {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*")/)
  if (match === null) return undefined
  const settingKey = match[1]
  const rawValue = match[2]
  if (settingKey !== key || rawValue === undefined) return undefined
  return rawValue
}

function isSectionHeader(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith("[") && trimmed.endsWith("]")
}

function agentNameFromToml(fileName: string): string {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName
}

function parseJsonString(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "string" ? parsed : null
  } catch (error) {
    if (error instanceof Error) return null
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") throw error
    return false
  }
}

function nodeErrorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null
  return typeof error.code === "string" ? error.code : null
}
