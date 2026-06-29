import type { SkillInfo } from "./types"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { isDisabledSkillAlias } from "../../features/opencode-skill-loader/skill-discovery"

const SHARED_SKILL_PREFIX = "shared/"

export type NativeSkillEntry = {
  name: string
  description: string
  location: string
  content: string
}

export type NativeSkillGetter = {
  readonly get: (name: string) => NativeSkillEntry | undefined | Promise<NativeSkillEntry | undefined>
}

export type NativeSkillMissResolution =
  | { readonly kind: "resolved"; readonly skill: LoadedSkill }
  | { readonly kind: "disabled"; readonly name: string }
  | { readonly kind: "miss" }
  | { readonly kind: "unavailable" }

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

function normalizeSkillName(name: string): string {
  return name.toLowerCase()
}

function normalizeDisabledSkills(disabledSkills: ReadonlySet<string> | undefined): ReadonlySet<string> | undefined {
  if (!disabledSkills) return undefined
  return new Set(Array.from(disabledSkills, normalizeSkillName))
}

function nativeSkillScope(native: NativeSkillEntry): LoadedSkill["scope"] {
  return normalizeSkillName(native.name).startsWith(SHARED_SKILL_PREFIX) ? "shared" : "config"
}

export function nativeSkillToLoadedSkill(native: NativeSkillEntry): LoadedSkill {
  return {
    name: native.name,
    path: native.location,
    definition: {
      name: native.name,
      description: native.description,
      template: native.content,
    },
    scope: nativeSkillScope(native),
  }
}

function nativeSkillToAliasCheckSkill(native: NativeSkillEntry): LoadedSkill {
  const name = normalizeSkillName(native.name)
  return {
    ...nativeSkillToLoadedSkill(native),
    name,
    definition: {
      name,
      description: native.description,
      template: native.content,
    },
  }
}

export function mergeNativeSkills(
  skills: LoadedSkill[],
  nativeSkills: NativeSkillEntry[],
  disabledSkills?: ReadonlySet<string>,
): void {
  const knownNames = new Set(skills.map((skill) => normalizeSkillName(skill.name)))
  const disabledSkillAliases = normalizeDisabledSkills(disabledSkills)
  for (const native of nativeSkills) {
    const nativeName = normalizeSkillName(native.name)
    if (knownNames.has(nativeName)) continue
    const loadedSkill = nativeSkillToLoadedSkill(native)
    if (disabledSkillAliases && isDisabledSkillAlias(nativeSkillToAliasCheckSkill(native), disabledSkillAliases)) continue
    skills.push(loadedSkill)
    knownNames.add(nativeName)
  }
}

export function mergeNativeSkillInfos(
  skillInfos: SkillInfo[],
  nativeSkills: NativeSkillEntry[],
  disabledSkills?: ReadonlySet<string>,
): void {
  const knownNames = new Set(skillInfos.map((skill) => normalizeSkillName(skill.name)))
  const disabledSkillAliases = normalizeDisabledSkills(disabledSkills)
  for (const native of nativeSkills) {
    const nativeName = normalizeSkillName(native.name)
    if (knownNames.has(nativeName)) continue
    if (disabledSkillAliases && isDisabledSkillAlias(nativeSkillToAliasCheckSkill(native), disabledSkillAliases)) continue
    skillInfos.push({
      name: native.name,
      description: native.description,
      location: native.location,
      scope: nativeSkillScope(native),
    })
    knownNames.add(nativeName)
  }
}

export async function resolveNativeSkillOnMiss(args: {
  readonly nativeSkills: NativeSkillGetter | undefined
  readonly name: string
  readonly disabledSkills?: ReadonlySet<string>
}): Promise<NativeSkillMissResolution> {
  const { nativeSkills, name, disabledSkills } = args
  if (!nativeSkills) return { kind: "unavailable" }

  try {
    const native = await nativeSkills.get(name)
    if (!native) return { kind: "miss" }

    const disabledSkillAliases = normalizeDisabledSkills(disabledSkills)
    if (disabledSkillAliases && isDisabledSkillAlias(nativeSkillToAliasCheckSkill(native), disabledSkillAliases)) {
      if ("all" in nativeSkills && typeof nativeSkills.all === "function") {
        const listedNativeSkills = await nativeSkills.all()
        const listedDisabledSkill = Array.isArray(listedNativeSkills)
          ? listedNativeSkills.some((listedNative) => normalizeSkillName(listedNative.name) === normalizeSkillName(native.name))
          : false
        if (listedDisabledSkill) return { kind: "miss" }
      }
      return { kind: "disabled", name: native.name }
    }

    return { kind: "resolved", skill: nativeSkillToLoadedSkill(native) }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "miss" }
  }
}

export function isPromiseLike<TValue>(value: TValue | Promise<TValue>): value is Promise<TValue> {
  return typeof value === "object" && value !== null && "then" in value
}
