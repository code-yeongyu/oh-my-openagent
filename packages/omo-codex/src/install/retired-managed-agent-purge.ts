import { lstat, readFile, rm } from "node:fs/promises"
import { join } from "node:path"

const RETIRED_MANAGED_AGENT_FILES = [
  {
    fileName: "codex-ultrawork-reviewer.toml",
    requiredMarkers: [
      'name = "codex-ultrawork-reviewer"',
      'description = "Strict ultrawork verification reviewer.',
      'developer_instructions = """You are the ultrawork verification reviewer.',
    ],
  },
] as const

export async function purgeRetiredManagedAgentFiles(input: { readonly codexHome: string }): Promise<void> {
  const agentsDir = join(input.codexHome, "agents")
  if (!(await exists(agentsDir))) return

  for (const retiredAgent of RETIRED_MANAGED_AGENT_FILES) {
    const agentPath = join(agentsDir, retiredAgent.fileName)
    if (!(await exists(agentPath))) continue
    const agentStat = await lstat(agentPath)
    if (agentStat.isDirectory() && !agentStat.isSymbolicLink()) continue
    const content = await readTextIfExists(agentPath)
    if (content === null || !hasRequiredMarkers(content, retiredAgent.requiredMarkers)) continue
    await rm(agentPath, { force: true })
  }
}

function hasRequiredMarkers(content: string, markers: readonly string[]): boolean {
  return markers.every((marker) => content.includes(marker))
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null
    throw error
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
