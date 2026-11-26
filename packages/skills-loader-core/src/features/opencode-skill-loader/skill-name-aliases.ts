/**
 * Retired skill names that still resolve to the skill that replaced them. Every surface that accepts
 * a skill name (load_skills, /skill, disabled_skills, a read of an installed SKILL.md path) consults
 * this one table; no surface keeps a second copy of a renamed skill.
 */
const SKILL_NAME_ALIASES: ReadonlyMap<string, string> = new Map([["git-master", "git"]])

export function resolveSkillAlias(name: string): string {
  return SKILL_NAME_ALIASES.get(name) ?? name
}

export function skillNamesResolvingTo(canonicalName: string): readonly string[] {
  return [
    canonicalName,
    ...[...SKILL_NAME_ALIASES].filter(([, target]) => target === canonicalName).map(([alias]) => alias),
  ]
}
