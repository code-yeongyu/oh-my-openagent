import { join } from "path"
import { lstatSync } from "node:fs"
import * as yaml from "js-yaml"
import type { SkillMcpConfig } from "../../types"
import { readSkillFileChecked } from "./checked-skill-read"
import { reportSkillLoadError, type SkillProvenance, type SkillDiagnosticSink } from "./skill-provenance"

export function parseSkillMcpConfigFromFrontmatter(content: string): SkillMcpConfig | undefined {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatterMatch) return undefined

  try {
    const parsed = yaml.load(frontmatterMatch[1]) as Record<string, unknown>
    if (parsed && typeof parsed === "object" && "mcp" in parsed && parsed.mcp) {
      return parsed.mcp as SkillMcpConfig
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return undefined
  }
  return undefined
}

export async function loadMcpJsonFromDir(skillDir: string, provenance: SkillProvenance = { kind: "user", selectedRoot: skillDir }, onDiagnostic?: SkillDiagnosticSink): Promise<SkillMcpConfig | undefined> {
  return readMcpJsonFromDirChecked(skillDir, provenance, onDiagnostic)
}

export function readMcpJsonFromDirChecked(skillDir: string, provenance: SkillProvenance, onDiagnostic?: SkillDiagnosticSink): SkillMcpConfig | undefined {
  const mcpJsonPath = join(skillDir, "mcp.json")

  try {
    try { lstatSync(mcpJsonPath) } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    }
    const content = readSkillFileChecked(mcpJsonPath, provenance)
    const parsed = JSON.parse(content) as Record<string, unknown>

    if (parsed && typeof parsed === "object" && "mcpServers" in parsed && parsed.mcpServers) {
      return parsed.mcpServers as SkillMcpConfig
    }

    if (parsed && typeof parsed === "object" && !("mcpServers" in parsed)) {
      const hasCommandField = Object.values(parsed).some(
        (value) => value && typeof value === "object" && "command" in (value as Record<string, unknown>)
      )
      if (hasCommandField) {
        return parsed as SkillMcpConfig
      }
    }
  } catch (error) {
    reportSkillLoadError(error, mcpJsonPath, onDiagnostic)
    if (!(error instanceof Error)) {
      throw error
    }
    return undefined
  }

  return undefined
}
