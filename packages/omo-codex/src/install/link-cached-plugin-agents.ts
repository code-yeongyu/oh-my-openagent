import { copyFile, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import type { PreservedAgentReasoning } from "./managed-agent-reasoning-defaults"
import { restorePreservedReasoning, restorePreservedServiceTier } from "./preserved-agent-settings"
import { purgeRetiredManagedAgentFiles } from "./retired-managed-agent-purge"

export { capturePreservedAgentReasoning, capturePreservedAgentServiceTier } from "./preserved-agent-settings"

const MANIFEST_FILE = ".installed-agents.json"

export interface LinkedAgent {
  readonly name: string
  readonly path: string
  readonly target: string
}

type LinkPlatform = NodeJS.Platform

export async function linkCachedPluginAgents(input: {
  readonly codexHome: string
  readonly pluginRoot: string
  readonly platform?: LinkPlatform
  readonly preservedReasoning?: ReadonlyMap<string, PreservedAgentReasoning>
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
    await restorePreservedServiceTier({
      linkPath,
      preserved: input.preservedServiceTier?.has(agentName) ?? false,
      value: input.preservedServiceTier?.get(agentName) ?? null,
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

function agentNameFromToml(fileName: string): string {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName
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
