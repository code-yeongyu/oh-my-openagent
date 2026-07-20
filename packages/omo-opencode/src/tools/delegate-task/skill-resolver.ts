import type { GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"
import { discoverSkills } from "../../features/opencode-skill-loader"
import {
  getAllSkills,
  isDisabledSkillAlias,
} from "../../features/opencode-skill-loader/skill-discovery"
import {
  extractSkillTemplate,
  injectGitMasterConfig,
} from "../../features/opencode-skill-loader/skill-content"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import { getAgentConfigKey } from "../../shared/agent-display-names"
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
  targetAgent?: string
  nativeSkills?: DelegateTaskToolOptions["nativeSkills"]
  nativeSkillEntries?: NativeSkillEntry[]
  getLoadedSkills?: DelegateTaskToolOptions["getLoadedSkills"]
}

function isSkillAllowedForTargetAgent(skill: LoadedSkill, targetAgent: string | undefined): boolean {
  const restrictedAgent = skill.definition.agent
  if (!restrictedAgent) return true
  if (!targetAgent) return false
  return getAgentConfigKey(restrictedAgent) === getAgentConfigKey(targetAgent)
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
    const errorMessage = err instanceof Error ? err.message : String(err)
    log("[skill-resolver] nativeSkills.all() failed; falling back to disk-only skills", {
      error: errorMessage,
    })
    return []
  }
}

async function loadBaseSkills(options: ResolveSkillContentOptions): Promise<LoadedSkill[]> {
  if (options.getLoadedSkills) {
    try {
      const loadedSkills = await options.getLoadedSkills()
      return [...loadedSkills]
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      log("[skill-resolver] getLoadedSkills() failed; falling back to disk-discovered skills", {
        error: errorMessage,
      })
    }
  }
  return [...(await getAllSkills(options))]
}

export async function resolveSkillContent(
  skills: string[],
  options: ResolveSkillContentOptions,
): Promise<{ content: string | undefined; contents: string[]; error: string | null }> {
  if (skills.length === 0) {
    return { content: undefined, contents: [], error: null }
  }

  const baseSkills = await loadBaseSkills(options)
  let nativeEntries = options.nativeSkillEntries
  let nativeMerged = false

  const mergeNativeEntries = async (): Promise<void> => {
    if (nativeMerged) return
    nativeEntries = await loadNativeSkillEntries(options.nativeSkills, nativeEntries)
    mergeNativeSkills(baseSkills, nativeEntries, options.disabledSkills)
    nativeMerged = true
  }

  const resolved = new Map<string, string>()
  const notFound: string[] = []
  let unfilteredDiscoveredSkills: LoadedSkill[] | undefined

  const getUnfilteredDiscoveredSkills = async (): Promise<LoadedSkill[]> => {
    if (unfilteredDiscoveredSkills) return unfilteredDiscoveredSkills
    unfilteredDiscoveredSkills = await discoverSkills({
      includeClaudeCodePaths: true,
      directory: options.directory,
    })
    return unfilteredDiscoveredSkills
  }

  for (const name of skills) {
    let skill = matchSkillByName(baseSkills, name)
    if (!skill) {
      await mergeNativeEntries()
      skill = matchSkillByName(baseSkills, name)
    }
    if (!skill && options.browserProvider === undefined) {
      skill = matchSkillByName(await getUnfilteredDiscoveredSkills(), name)
      if (skill && options.disabledSkills && isDisabledSkillAlias(skill, options.disabledSkills)) {
        skill = undefined
      }
    }
    if (!skill) {
      notFound.push(name)
      continue
    }
    if (!isSkillAllowedForTargetAgent(skill, options.targetAgent)) {
      log("[skill-resolver] filtered agent-restricted skill for delegate target", {
        skill: skill.name,
        restricted_agent: skill.definition.agent,
        target_agent: options.targetAgent ?? "(unknown)",
      })
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
