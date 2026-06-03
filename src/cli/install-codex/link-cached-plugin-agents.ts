import { copyFile, lstat, mkdir, readdir, symlink, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

const MANIFEST_FILE = ".installed-agents.json"

export interface LinkedAgent {
  readonly name: string
  readonly path: string
  readonly target: string
  readonly managed: boolean
}

type LinkPlatform = NodeJS.Platform

export async function linkCachedPluginAgents(input: {
  readonly codexHome: string
  readonly pluginRoot: string
  readonly platform?: LinkPlatform
}): Promise<readonly LinkedAgent[]> {
  const platform = input.platform ?? process.platform
  const bundledAgents = await discoverBundledAgents(input.pluginRoot)
  if (bundledAgents.length === 0) {
    await writeManifest(input.pluginRoot, [])
    return []
  }
  const agentsDir = join(input.codexHome, "agents")
  await mkdir(agentsDir, { recursive: true })
  const linked: LinkedAgent[] = []
  for (const agentPath of bundledAgents) {
    const linkPath = join(agentsDir, basename(agentPath))
    const installed = platform === "win32"
      ? await copyIfMissing(linkPath, agentPath)
      : await symlinkIfMissing(linkPath, agentPath)
    linked.push({ name: basename(agentPath), path: linkPath, target: installed.target, managed: installed.managed })
  }
  await writeManifest(
    input.pluginRoot,
    linked.filter((entry) => entry.managed).map((entry) => entry.path),
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

async function symlinkIfMissing(linkPath: string, target: string): Promise<{ readonly target: string; readonly managed: boolean }> {
  if (await existingAgentFile(linkPath)) return { target: linkPath, managed: false }
  await symlink(target, linkPath)
  return { target, managed: true }
}

async function copyIfMissing(linkPath: string, target: string): Promise<{ readonly target: string; readonly managed: boolean }> {
  if (await existingAgentFile(linkPath)) return { target: linkPath, managed: false }
  await copyFile(target, linkPath)
  return { target, managed: true }
}

async function existingAgentFile(linkPath: string): Promise<boolean> {
  if (!(await exists(linkPath))) return false
  const entryStat = await lstat(linkPath)
  if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
    throw new Error(`${linkPath} already exists and is a directory; refusing to replace`)
  }
  return true
}

async function writeManifest(pluginRoot: string, agentPaths: readonly string[]): Promise<void> {
  const manifestPath = join(pluginRoot, MANIFEST_FILE)
  const payload = { agents: [...agentPaths].sort() }
  await writeFile(manifestPath, `${JSON.stringify(payload, null, "\t")}\n`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}
