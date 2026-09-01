export type SkillDisableConfig = {
  readonly disabled_skills?: readonly string[]
  readonly skills?: unknown
}

type SkillsConfigRecord = {
  readonly disable?: unknown
  readonly [key: string]: unknown
}

export function normalizeSkillAliasName(name: string): string {
  return name.toLowerCase()
}

function isSkillsConfigRecord(value: unknown): value is SkillsConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDisabledSkillConfigEntry(entry: unknown): boolean {
  if (entry === false) return true
  if (entry === true) return false
  if (!isSkillsConfigRecord(entry)) return false
  return entry.disable === true
}

export function collectDisabledSkillAliases(config: SkillDisableConfig): Set<string> {
  const disabledSkills = new Set<string>(
    (config.disabled_skills ?? []).map(normalizeSkillAliasName),
  )
  const skillsConfig = config.skills
  if (!isSkillsConfigRecord(skillsConfig)) return disabledSkills

  if (Array.isArray(skillsConfig.disable)) {
    for (const name of skillsConfig.disable) {
      if (typeof name === "string") {
        disabledSkills.add(normalizeSkillAliasName(name))
      }
    }
  }

  for (const [name, entry] of Object.entries(skillsConfig)) {
    if (name === "sources" || name === "enable" || name === "disable") continue
    if (isDisabledSkillConfigEntry(entry)) {
      disabledSkills.add(normalizeSkillAliasName(name))
    }
  }

  return disabledSkills
}

function isDisabledAlias(name: string, disabledSkills: ReadonlySet<string>): boolean {
  const normalizedName = normalizeSkillAliasName(name)
  if (disabledSkills.has(normalizedName)) return true

  for (const disabledSkill of disabledSkills) {
    if (normalizeSkillAliasName(disabledSkill) === normalizedName) return true
  }

  return false
}

export function isDisabledSkillName(
  name: string,
  disabledSkills: ReadonlySet<string>,
): boolean {
  return isDisabledAlias(normalizeSkillAliasName(name), disabledSkills)
}
