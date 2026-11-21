import { join, resolve } from "path"
import { homedir } from "node:os"
import { getClaudeConfigDir } from "../../shared"
import { bunFile } from "../../shared/bun-file-shim"
import { log } from "../../shared/logger"

export type ProjectTrustSource = "claude-trust-dialog" | "env-opt-in" | "no-decision"

export interface ProjectTrustDecision {
  readonly trusted: boolean
  readonly source: ProjectTrustSource
}

interface ClaudeProjectEntry {
  hasTrustDialogAccepted?: boolean
}

interface ClaudeGlobalConfig {
  projects?: Record<string, ClaudeProjectEntry>
}

function isEnvTrustOptIn(): boolean {
  const value = process.env.OMO_CLAUDE_SETTINGS_TRUST
  return value === "1" || value === "true"
}

async function readClaudeTrustDecision(projectDir: string): Promise<boolean | undefined> {
  const candidatePaths = [join(getClaudeConfigDir(), ".claude.json"), join(homedir(), ".claude.json")]

  for (const configPath of candidatePaths) {
    let content: string
    try {
      content = await bunFile(configPath).text()
    } catch {
      continue
    }

    try {
      const parsed = JSON.parse(content) as ClaudeGlobalConfig
      const entry = parsed.projects?.[projectDir]
      if (entry && typeof entry.hasTrustDialogAccepted === "boolean") {
        return entry.hasTrustDialogAccepted
      }
      return undefined
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("Failed to parse Claude global config for project trust", { configPath, error: errorMessage })
      return undefined
    }
  }

  return undefined
}

export async function resolveProjectTrust(projectDir: string): Promise<ProjectTrustDecision> {
  const resolvedDir = resolve(projectDir)
  const claudeDecision = await readClaudeTrustDecision(resolvedDir)

  if (claudeDecision !== undefined) {
    return { trusted: claudeDecision, source: "claude-trust-dialog" }
  }

  if (isEnvTrustOptIn()) {
    return { trusted: true, source: "env-opt-in" }
  }

  return { trusted: false, source: "no-decision" }
}
