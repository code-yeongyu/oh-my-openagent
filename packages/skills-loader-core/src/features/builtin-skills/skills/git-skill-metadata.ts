import { resolveSkillAlias } from "../../opencode-skill-loader/skill-name-aliases"

export const GIT_SKILL_NAME = "git"

export const GIT_SKILL_DESCRIPTION =
  "MUST USE for ANY git operations. Atomic commits, rebase/squash, history search (blame, bisect, log -S). STRONGLY RECOMMENDED: Use with task(category='quick', load_skills=['git'], ...) to save context. Triggers: 'commit', 'rebase', 'squash', 'who wrote', 'when was X added', 'find the commit that'."

export function isGitSkillName(name: string): boolean {
  return resolveSkillAlias(name.toLowerCase()) === GIT_SKILL_NAME
}
