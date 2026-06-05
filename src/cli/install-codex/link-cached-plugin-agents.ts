import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

const MANIFEST_FILE = ".installed-agents.json"

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

export async function linkCachedPluginAgents(input: {
  readonly codexHome: string
  readonly pluginRoot: string
  readonly platform?: LinkPlatform
  readonly preservedReasoning?: ReadonlyMap<string, string>
}): Promise<readonly LinkedAgent[]> {
  const bundledAgents = await discoverBundledAgents(input.pluginRoot)
  if (bundledAgents.length === 0) {
    await writeManifest(input.pluginRoot, [])
    return []
  }
  const agentsDir = join(input.codexHome, "agents")
  await mkdir(agentsDir, { recursive: true })
  const linked: LinkedAgent[] = []
  for (const agentPath of bundledAgents) {
    const agentFileName = basename(agentPath)
    const agentName = agentNameFromToml(agentFileName)
    const linkPath = join(agentsDir, agentFileName)
    await replaceWithCopy(linkPath, agentPath)
    await restorePreservedReasoning({
      agentName,
      linkPath,
      target: agentPath,
      value: input.preservedReasoning?.get(agentName),
    })
    linked.push({ name: agentFileName, path: linkPath, target: agentPath })
  }
  await writeManifest(
    input.pluginRoot,
    linked.map((entry) => entry.path),
  )
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

async function replaceWithCopy(linkPath: string, target: string): Promise<void> {
  await prepareReplacement(linkPath)
  await copyFile(target, linkPath)
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

async function restorePreservedReasoning(input: {
  readonly agentName: string
  readonly linkPath: string
  readonly target: string
  readonly value: string | undefined
}): Promise<void> {
  if (input.value === undefined) return
  const content = await readFile(input.target, "utf8")
  const bundledEffort = extractReasoningEffort(content)
  if (bundledEffort === input.value) return
  if (shouldUseBundledReasoning({ agentName: input.agentName, bundledEffort, preservedEffort: input.value })) return
  const replacement = replaceReasoningEffort(content, input.value)
  if (!replacement.replaced) return
  await writeFile(input.linkPath, replacement.content)
}

function shouldUseBundledReasoning(input: {
  readonly agentName: string
  readonly bundledEffort: string | null
  readonly preservedEffort: string
}): boolean {
  return (
    input.agentName === "codex-ultrawork-reviewer" &&
    input.bundledEffort === "high" &&
    input.preservedEffort === "xhigh"
  )
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
  for (const line of content.split(/\n/)) {
    if (isSectionHeader(line)) return null
    const match = line.match(/^\s*model_reasoning_effort\s*=\s*("(?:[^"\\]|\\.)*")/)
    const rawValue = match?.[1]
    if (rawValue === undefined) continue
    const parsed = parseJsonString(rawValue)
    if (parsed !== null) return parsed
  }
  return null
}

function replaceReasoningEffort(content: string, value: string): { readonly content: string; readonly replaced: boolean } {
  const lines = content.split(/\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || isSectionHeader(line)) break
    if (!/^\s*model_reasoning_effort\s*=/.test(line)) continue
    lines[index] = line.replace(/=\s*"(?:[^"\\]|\\.)*"/, `= ${JSON.stringify(value)}`)
    return { content: lines.join("\n"), replaced: true }
  }
  return { content, replaced: false }
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
