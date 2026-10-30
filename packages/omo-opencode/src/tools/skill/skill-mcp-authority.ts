import { realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import type { SkillMcpClientInfo } from "../../features/skill-mcp-manager"
import {
  pathIsInside, skillProvenance, userAllowedPaths, readSkillFileChecked,
  readMcpJsonFromDirChecked, parseSkillMcpConfigFromFrontmatter,
  knownHostUserRoots,
} from "@oh-my-opencode/skills-loader-core/opencode-skill-loader"

export function skillMcpClientInfo(
  skill: LoadedSkill, serverName: string, sessionID: string, directory?: string,
): SkillMcpClientInfo {
  const sourcePath = skill.mcpSourcePath ?? skill.path
  const provenance = skill.provenance ?? skillProvenance(skill.path ?? skill.resolvedPath ?? directory ?? ".", skill.scope)
  let hostUserTrusted = false
  if (provenance.kind === "host" && skill.path) {
    try {
      const canonical = realpathSync.native(skill.path)
      const allowed = userAllowedPaths(provenance)
      for (const root of knownHostUserRoots()) {
        try { allowed.roots.push(realpathSync.native(root)) } catch (error) { if (!(error instanceof Error)) throw error }
      }
      hostUserTrusted = allowed.roots.some((root) => pathIsInside(canonical, root)) || allowed.files.includes(canonical)
    } catch (error) { if (!(error instanceof Error)) throw error }
  }
  return {
    serverName, sessionID, skillName: skill.name,
    scope: provenance.kind === "host" ? "host" : skill.scope, provenance, hostUserTrusted,
    sourcePath, sourceKind: sourcePath?.endsWith("mcp.json") ? "sidecar" : "frontmatter",
    directory: directory ?? provenance.projectRoot,
    revalidateDeclaration: skill.path ? async () => {
      const path = skill.path
      if (!path) return undefined
      const raw = readSkillFileChecked(path, provenance)
      const sidecar = readMcpJsonFromDirChecked(dirname(path), provenance)
      const configs = sidecar ?? parseSkillMcpConfigFromFrontmatter(raw)
      const config = configs?.[serverName]
      return config ? {
        config, sourcePath: sidecar ? join(dirname(path), "mcp.json") : path,
        sourceKind: sidecar ? "sidecar" : "frontmatter",
      } : undefined
    } : undefined,
  }
}
