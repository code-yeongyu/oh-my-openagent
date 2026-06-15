import type { SkillInfo } from "./types"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { isDisabledSkillAlias } from "../../features/opencode-skill-loader/skill-discovery"

export type NativeSkillEntry = {
  name: string
  description: string
  location: string
  content: string
}

export function loadedSkillToInfo(skill: LoadedSkill): SkillInfo {
  return {
    name: skill.name,
    description: skill.definition.description || "",
    location: skill.path,
    scope: skill.scope,
    license: skill.license,
    compatibility: skill.compatibility,
    metadata: skill.metadata,
    allowedTools: skill.allowedTools,
  }
}

function nativeSkillToLoadedSkill(native: NativeSkillEntry): LoadedSkill {
  return {
    name: native.name,
    path: native.location,
    definition: {
      name: native.name,
      description: native.description,
      template: native.content,
    },
    scope: "config",
  }
}

export function mergeNativeSkills(
  skills: LoadedSkill[],
  nativeSkills: NativeSkillEntry[],
  disabledSkills?: ReadonlySet<string>,
): void {
  const knownNames = new Set(skills.map((skill) => skill.name))
  for (const native of nativeSkills) {
    if (knownNames.has(native.name)) continue
    const loadedSkill = nativeSkillToLoadedSkill(native)
    if (disabledSkills && isDisabledSkillAlias(loadedSkill, disabledSkills)) continue
    skills.push(loadedSkill)
    knownNames.add(native.name)
  }
}

export function mergeNativeSkillInfos(
  skillInfos: SkillInfo[],
  nativeSkills: NativeSkillEntry[],
  disabledSkills?: ReadonlySet<string>,
): void {
  const knownNames = new Set(skillInfos.map((skill) => skill.name))
  for (const native of nativeSkills) {
    if (knownNames.has(native.name)) continue
    if (disabledSkills && isDisabledSkillAlias(nativeSkillToLoadedSkill(native), disabledSkills)) continue
    skillInfos.push({
      name: native.name,
      description: native.description,
      location: native.location,
      scope: "config",
    })
    knownNames.add(native.name)
  }
}

export function isPromiseLike<TValue>(value: TValue | Promise<TValue>): value is Promise<TValue> {
  return typeof value === "object" && value !== null && "then" in value
}
