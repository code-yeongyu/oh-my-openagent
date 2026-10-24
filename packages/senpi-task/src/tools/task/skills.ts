import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

import type { loadSkillsFromDir as discoverSkillsFromDir } from "@code-yeongyu/senpi"
import { detectWorktreePath } from "@oh-my-opencode/skills-loader-core/shared/project-discovery-dirs"

import { senpiBarrel } from "../../lazy/senpi-barrel"
import type { LoadedSkill, SkillLoader, SkillResolution } from "./types"
import { readProjectSkills, type CheckedProjectSkills } from "./checked-project-skills"
import { readSkillFileChecked } from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/checked-skill-read"
import {
  checkSkillPath, skillProvenance, reportSkillLoadError,
  type SkillProvenance,
} from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/skill-provenance"

export type FsSkillLoaderOptions = {
  readonly homeDir?: string
  readonly agentDir?: string
  readonly extraDirs?: readonly string[]
  readonly loadSkillsFromDir?: typeof discoverSkillsFromDir
}

// v1 load_skills contract: wrap each resolved SKILL.md in a named block and place it before the
// prompt. Empty input leaves the prompt untouched.
export function buildSkillPrepend(skills: readonly LoadedSkill[], prompt: string): string {
  if (skills.length === 0) return prompt
  const block = skills.map((skill) => {
    if (skill.location === undefined) return `<skill name="${skill.name}">\n${skill.content}\n</skill>`
    return [
      `<skill name="${skill.name}" location="${skill.location}">`,
      `References are relative to ${dirname(skill.location)}.`,
      "",
      skill.content,
      "</skill>",
    ].join("\n")
  }).join("\n\n")
  return `${block}\n\n${prompt}`
}

function ancestorAgentSkillDirs(cwd: string): readonly string[] {
  const dirs: string[] = []
  let current = resolve(cwd)
  while (true) {
    dirs.push(join(current, ".agents", "skills"))
    if (existsSync(join(current, ".git"))) return dirs
    const parent = dirname(current)
    if (parent === current) return dirs
    current = parent
  }
}

function uniqueDirs(dirs: readonly string[]): readonly string[] {
  return [...new Set(dirs.map((dir) => resolve(dir)))]
}

function searchDirs(
  cwd: string,
  home: string,
  agentDir: string,
  extraDirs: readonly string[],
): readonly string[] {
  return uniqueDirs([
    join(cwd, ".senpi", "skills"),
    ...ancestorAgentSkillDirs(cwd),
    join(cwd, ".pi", "skills"),
    join(agentDir, "skills"),
    join(home, ".agents", "skills"),
    ...extraDirs,
  ])
}

function skillBody(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, "\n")
  if (!normalized.startsWith("---\n")) return raw
  const closing = normalized.indexOf("\n---", 4)
  if (closing < 0) return raw
  return normalized.slice(closing + 4).replace(/^\n/, "").trim()
}

function readSkillFile(name: string, path: string, provenance: SkillProvenance): LoadedSkill {
  return {
    name,
    content: skillBody(readSkillFileChecked(path, provenance)),
    location: path,
  }
}

function blockedSkillName(path: string): string {
  return basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path, ".md")
}

function directSkill(name: string, dir: string, provenance: SkillProvenance): LoadedSkill | undefined {
  if (provenance.kind === "project-auto" && existsSync(join(dir, "SKILL.md"))) return undefined
  const candidates = [join(dir, name, "SKILL.md"), join(dir, `${name}.md`)]
  const path = candidates.find(existsSync)
  return path === undefined ? undefined : readSkillFile(name, path, provenance)
}

function discoveredSkill(
  name: string,
  dir: string,
  discover: typeof discoverSkillsFromDir,
  cache: Map<string, ReturnType<typeof discoverSkillsFromDir>>,
  provenance: SkillProvenance,
  projectCache: Map<string, CheckedProjectSkills>,
): LoadedSkill | undefined {
  if (!existsSync(dir)) return undefined
  if (provenance.kind === "project-auto") {
    let discovery = projectCache.get(dir)
    if (!discovery) {
      discovery = readProjectSkills(dir, provenance)
      projectCache.set(dir, discovery)
    }
    const skill = discovery.skills.get(name)
    // Only a blocked link that belongs to the requested skill explains its absence; another skill's link
    // would name the wrong file, so an unrelated miss stays "missing" (#10693 review L1).
    const blocked = skill ? undefined : discovery.blocked.find((error) => blockedSkillName(error.diagnostic.path) === name)
    if (blocked) throw blocked
    const failed = skill ? undefined : discovery.errors.find((entry) => blockedSkillName(entry.path) === name)
    if (failed) throw failed.error
    return skill === undefined ? undefined : readSkillFile(name, skill.location ?? "", provenance)
  }
  let discovery = cache.get(dir)
  if (discovery === undefined) {
    discovery = discover({ dir, source: "user" })
    cache.set(dir, discovery)
  }
  const skill = discovery.skills.find((candidate) => candidate.name === name)
  return skill === undefined ? undefined : readSkillFile(name, skill.filePath, provenance)
}

function readSkill(
  name: string,
  dirs: readonly string[],
  discover: typeof discoverSkillsFromDir,
  cache: Map<string, ReturnType<typeof discoverSkillsFromDir>>,
  userDirs: readonly string[],
  rejected: { name: string; reason: string }[],
  projectCache: Map<string, CheckedProjectSkills>,
  projectRoot: string | undefined,
): LoadedSkill | undefined {
  if (!/^[a-z0-9-]+$/.test(name)) return undefined
  for (const dir of dirs) {
    const provenance = skillProvenance(dir, userDirs.includes(dir) ? "user" : "project", {
      kind: userDirs.includes(dir) ? "user" : "project-auto",
      selectedRoot: dir, userRoots: userDirs,
      projectRoot: projectRoot ?? skillProvenance(dir, "project").projectRoot,
    })
    try {
      if (existsSync(dir)) checkSkillPath(dir, provenance, true)
      const skill = directSkill(name, dir, provenance) ?? discoveredSkill(name, dir, discover, cache, provenance, projectCache)
      if (skill !== undefined) return skill
    } catch (error) {
      reportSkillLoadError(error, dir)
      if (error instanceof Error) rejected.push({ name, reason: error.message })
    }
  }
  return undefined
}

// Filesystem-backed loader. Searches project `.senpi/skills`, `~/.senpi/agent/skills`, then any extra
// dirs (the omo-senpi plugin skills path is injected by the component). Missing names never fail.
export function createFsSkillLoader(options: FsSkillLoaderOptions = {}): SkillLoader {
  const home = options.homeDir ?? homedir()
  const agentDir = options.agentDir ?? join(home, ".senpi", "agent")
  const extraDirs = options.extraDirs ?? []
  // The default discovery reads the senpi barrel lazily through the boundary; the loader runs on
  // the task spawn path, which awaits loadSenpiBarrel() before resolving skills.
  const discover = options.loadSkillsFromDir ?? ((dir: Parameters<typeof discoverSkillsFromDir>[0]) => senpiBarrel().loadSkillsFromDir(dir))
  return (names, cwd): SkillResolution => {
    const dirs = searchDirs(cwd, home, agentDir, extraDirs)
    const discoveryCache = new Map<string, ReturnType<typeof discoverSkillsFromDir>>()
    const projectCache = new Map<string, CheckedProjectSkills>()
    const skills: LoadedSkill[] = []
    const missing: string[] = []
    const rejected: { name: string; reason: string }[] = []
    const userDirs = uniqueDirs([join(agentDir, "skills"), join(home, ".agents", "skills"), ...extraDirs])
    const projectRoot = detectWorktreePath(cwd)
    for (const name of names) {
      const skill = readSkill(name, dirs, discover, discoveryCache, userDirs, rejected, projectCache, projectRoot)
      if (skill === undefined && !rejected.some((entry) => entry.name === name)) missing.push(name)
      else if (skill !== undefined) skills.push(skill)
    }
    return {
      prepend: buildSkillPrepend(skills, ""),
      resolved: skills.map((skill) => skill.name),
      missing,
      skills,
      rejected: rejected.filter((entry) => !skills.some((skill) => skill.name === entry.name)),
    }
  }
}
