import { existsSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { BuiltinAgentNameSchema } from "../config/schema/agent-names"
import { getConfigDir } from "./config-manager/config-context"

export const MANAGED_OPENCODE_AGENT_NAMES: readonly string[] = [...BuiltinAgentNameSchema.options]

const AGENT_DIR_NAMES = ["agent", "agents"] as const
const AGENT_FILE_EXTENSIONS = new Set([".md", ".mdx"])

export interface OpenCodeAgentCleanupOptions {
  readonly configDir?: string
  readonly project?: string
}

export interface OpenCodeAgentCleanupResult {
  readonly scannedDirs: readonly string[]
  readonly removedPaths: readonly string[]
}

function isManagedAgentFileName(fileName: string): boolean {
  const dotIndex = fileName.lastIndexOf(".")
  if (dotIndex <= 0) return false
  const extension = fileName.slice(dotIndex).toLowerCase()
  if (!AGENT_FILE_EXTENSIONS.has(extension)) return false
  return MANAGED_OPENCODE_AGENT_NAMES.includes(fileName.slice(0, dotIndex))
}

function sweepAgentDir(
  agentDir: string,
  result: { scannedDirs: string[]; removedPaths: string[] },
): void {
  if (!existsSync(agentDir)) return

  result.scannedDirs.push(agentDir)

  for (const entry of readdirSync(agentDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const filePath = join(agentDir, entry.name)
    if (!isManagedAgentFileName(entry.name)) continue
    rmSync(filePath)
    result.removedPaths.push(filePath)
  }
}

export function removeManagedOpenCodeAgentDefinitions(
  options: OpenCodeAgentCleanupOptions = {},
): OpenCodeAgentCleanupResult {
  const configDir = options.configDir ?? getConfigDir()
  const projectRoot = options.project ?? process.cwd()

  const agentRoots = [
    ...AGENT_DIR_NAMES.map((dirName) => join(configDir, dirName)),
    ...AGENT_DIR_NAMES.map((dirName) => join(projectRoot, ".opencode", dirName)),
  ]

  const result = {
    scannedDirs: [] as string[],
    removedPaths: [] as string[],
  }

  for (const agentDir of agentRoots) {
    sweepAgentDir(agentDir, result)
  }

  return result
}
