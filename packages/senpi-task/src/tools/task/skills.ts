import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { SkillLoader, SkillResolution } from "./types"

type ResolvedSkill = {
  readonly name: string
  readonly content: string
}

type FsSkillLoaderOptions = {
  readonly homeDir?: string
  readonly extraDirs?: readonly string[]
}

// v1 load_skills contract: wrap each resolved SKILL.md in a named block and place it before the
// prompt. Empty input leaves the prompt untouched.
export function buildSkillPrepend(skills: readonly ResolvedSkill[], prompt: string): string {
  if (skills.length === 0) return prompt
  const block = skills.map((skill) => `<skill name="${skill.name}">\n${skill.content}\n</skill>`).join("\n\n")
  return `${block}\n\n${prompt}`
}

function searchDirs(cwd: string, home: string, extraDirs: readonly string[]): readonly string[] {
  return [join(cwd, ".senpi", "skills"), join(home, ".senpi", "agent", "skills"), ...extraDirs]
}

function readSkill(name: string, dirs: readonly string[]): ResolvedSkill | undefined {
  for (const dir of dirs) {
    const skillPath = join(dir, name, "SKILL.md")
    if (existsSync(skillPath)) {
      return { name, content: readFileSync(skillPath, "utf8") }
    }
  }
  return undefined
}

// Filesystem-backed loader. Searches project `.senpi/skills`, `~/.senpi/agent/skills`, then any extra
// dirs (the omo-senpi plugin skills path is injected by the component). Missing names never fail.
export function createFsSkillLoader(options: FsSkillLoaderOptions = {}): SkillLoader {
  const home = options.homeDir ?? homedir()
  const extraDirs = options.extraDirs ?? []
  return (names, cwd): SkillResolution => {
    const dirs = searchDirs(cwd, home, extraDirs)
    const skills: ResolvedSkill[] = []
    const missing: string[] = []
    for (const name of names) {
      const skill = readSkill(name, dirs)
      if (skill === undefined) missing.push(name)
      else skills.push(skill)
    }
    return {
      prepend: buildSkillPrepend(skills, ""),
      resolved: skills.map((skill) => skill.name),
      missing,
    }
  }
}
