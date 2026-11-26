/**
 * Retired skill names that still resolve to the skill that replaced them. Every surface that accepts
 * a skill name (load_skills, /skill, disabled_skills, a read of an installed SKILL.md path) consults
 * this one table; no surface keeps a second copy of a renamed skill.
 */
const SKILL_NAME_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "git-master": "git",
})

export function resolveSkillAlias(name: string): string {
  return SKILL_NAME_ALIASES[name] ?? name
}

export function skillNamesResolvingTo(canonicalName: string): readonly string[] {
  return [
    canonicalName,
    ...Object.keys(SKILL_NAME_ALIASES).filter((alias) => SKILL_NAME_ALIASES[alias] === canonicalName),
  ]
}
