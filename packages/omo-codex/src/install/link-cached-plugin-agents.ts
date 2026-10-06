import { copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import {
  applyAgentOverride,
  readAgentModelReceipts,
  writeAgentModelReceipts,
  type AgentModelReceipt,
} from "./agent-model-overrides"
import type { CodexAgentOverride } from "./codex-agent-config"
import { handEditedAgentModel } from "./managed-agent-model-defaults"
import type { PreservedAgentReasoning } from "./managed-agent-reasoning-defaults"
import {
  extractModel,
  readTextIfExists,
  restorePreservedModel,
  restorePreservedReasoning,
  restorePreservedServiceTier,
} from "./preserved-agent-settings"
import { purgeRetiredManagedAgentFiles } from "./retired-managed-agent-purge"
import { installDefaultAgentRole } from "./default-agent-role"

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
  readonly defaultRoleEnabled?: boolean
  readonly agentOverrides?: ReadonlyMap<string, CodexAgentOverride>
}): Promise<readonly LinkedAgent[]> {
  const bundledAgents = await discoverBundledAgents(input.pluginRoot)
  await purgeRetiredManagedAgentFiles({ codexHome: input.codexHome })
  if (bundledAgents.length === 0) {
    await writeManifest(input.pluginRoot, [])
    return []
  }
  const agentsDir = join(input.codexHome, "agents")
  await mkdir(agentsDir, { recursive: true })
  const previousReceipts = await readAgentModelReceipts(input.codexHome)
  const receipts = new Map<string, AgentModelReceipt>()
  const linked: LinkedAgent[] = []
  for (const agentPath of bundledAgents) {
    const agentFileName = basename(agentPath)
    const agentName = agentNameFromToml(agentFileName)
    const linkPath = join(agentsDir, agentFileName)
    receipts.set(
      agentName,
      await syncAgentFile({ ...input, agentName, agentPath, linkPath, previousReceipt: previousReceipts.get(agentName) }),
    )
    linked.push({ name: agentFileName, path: linkPath, target: agentPath })
  }
  await writeAgentModelReceipts(input.codexHome, receipts)
  const worker = linked.find((entry) => entry.name === "lazycodex-worker-medium.toml")
  if (worker !== undefined) {
    const fallback = await installDefaultAgentRole({ codexHome: input.codexHome, worker, enabled: input.defaultRoleEnabled !== false })
    if (fallback !== null) linked.push(fallback)
  }
  await writeManifest(
    input.pluginRoot,
    linked.map((entry) => entry.path),
  )
  return linked
}

// Precedence per setting: omo.jsonc [codex].agents override > hand edit in the installed TOML > bundled default.
async function syncAgentFile(input: {
  readonly agentName: string
  readonly agentPath: string
  readonly linkPath: string
  readonly previousReceipt: AgentModelReceipt | undefined
  readonly preservedReasoning?: ReadonlyMap<string, PreservedAgentReasoning>
  readonly preservedServiceTier?: ReadonlyMap<string, string | null>
  readonly agentOverrides?: ReadonlyMap<string, CodexAgentOverride>
}): Promise<AgentModelReceipt> {
  const installed = await readTextIfExists(input.linkPath)
  const installedModel = installed === null ? null : extractModel(installed)
  const preservedReasoning = input.preservedReasoning?.get(input.agentName)
  const override = input.agentOverrides?.get(input.agentName)
  await replaceWithCopy(input.linkPath, input.agentPath)
  await restorePreservedModel({ linkPath: input.linkPath, value: handEditedAgentModel(installedModel, input.previousReceipt) })
  await restorePreservedReasoning({
    agentName: input.agentName,
    linkPath: input.linkPath,
    target: input.agentPath,
    value: preservedReasoning?.effort === input.previousReceipt?.reasoningEffort ? undefined : preservedReasoning,
  })
  await restorePreservedServiceTier({
    linkPath: input.linkPath,
    preserved: input.preservedServiceTier?.has(input.agentName) ?? false,
    value: input.preservedServiceTier?.get(input.agentName) ?? null,
  })
  await applyAgentOverride({ linkPath: input.linkPath, override })
  const model = override?.model ?? extractModel(await readFile(input.agentPath, "utf8"))
  return {
    ...(model === null ? {} : { model }),
    ...(override?.reasoningEffort === undefined ? {} : { reasoningEffort: override.reasoningEffort }),
  }
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
