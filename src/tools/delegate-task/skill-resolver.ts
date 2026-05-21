import type { GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"
import { discoverSkills } from "../../features/opencode-skill-loader"
import { getAllSkills } from "../../features/opencode-skill-loader/skill-discovery"
import {
  extractSkillTemplate,
  injectGitMasterConfig,
} from "../../features/opencode-skill-loader/skill-content"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import { log } from "../../shared/logger"
import { mergeNativeSkills } from "../skill/native-skills"
import type { NativeSkillEntry } from "../skill/native-skills"
import { matchSkillByName } from "../skill/skill-matcher"
import type { DelegateTaskToolOptions } from "./types"

type ResolveSkillContentOptions = {
  gitMasterConfig?: GitMasterConfig
  browserProvider?: BrowserAutomationProvider
  disabledSkills?: Set<string>
  teamModeEnabled?: boolean
  directory?: string
  nativeSkills?: DelegateTaskToolOptions["nativeSkills"]
  nativeSkillEntries?: NativeSkillEntry[]
}

async function loadNativeSkillEntries(
  nativeSkills: DelegateTaskToolOptions["nativeSkills"] | undefined,
  nativeSkillEntries: NativeSkillEntry[] | undefined,
): Promise<NativeSkillEntry[]> {
  if (nativeSkillEntries) return nativeSkillEntries
  if (!nativeSkills) return []
  try {
    const list = await nativeSkills.all()
    return Array.isArray(list) ? list : []
  } catch (err) {
    log("[skill-resolver] nativeSkills.all() failed; falling back to disk-only skills", {
      error: String(err),
    })
    return []
  }
}

export async function resolveSkillContent(
  skills: string[],
  options: ResolveSkillContentOptions,
): Promise<{ content: string | undefined; contents: string[]; error: string | null }> {
  if (skills.length === 0) {
    return { content: undefined, contents: [], error: null }
  }

  // Build the merged skill registry: OMO disk-discovered + OpenCode native (config.skills.paths).
  // OMO wins on collisions, matching the existing mergeNativeSkills semantics.
  const baseSkills: LoadedSkill[] = [...(await getAllSkills(options))]
  const nativeEntries = await loadNativeSkillEntries(options.nativeSkills, options.nativeSkillEntries)
  mergeNativeSkills(baseSkills, nativeEntries)

  const resolved = new Map<string, string>()
  const notFound: string[] = []

  for (const name of skills) {
    const skill = matchSkillByName(baseSkills, name)
    if (!skill) {
      notFound.push(name)
      continue
    }
    const template = extractSkillTemplate(skill)
    if (name === "git-master") {
      resolved.set(name, injectGitMasterConfig(template, options.gitMasterConfig))
    } else {
      resolved.set(name, template)
    }
  }

  if (notFound.length > 0) {
    // For the error message, include the freshest possible "Available" list — same merged set we
    // just searched, plus a fallback re-discovery if for some reason that came up empty.
    let available = baseSkills.map((s) => s.name).join(", ")
    if (!available) {
      const fallback = await discoverSkills({
        includeClaudeCodePaths: true,
        directory: options.directory,
      })
      available = fallback.map((s) => s.name).join(", ")
    }
    return {
      content: undefined,
      contents: [],
      error: `Skills not found: ${notFound.join(", ")}. Available: ${available}`,
    }
  }

  const contents = Array.from(resolved.values())
  return { content: contents.join("\n\n"), contents, error: null }
}
