import { resolveSkillAlias } from "../../opencode-skill-loader/skill-name-aliases"

export const GIT_SKILL_NAME = "git"

export const GIT_SKILL_DESCRIPTION =
  "Local git from eval cells: commit, push, worktree, base sync, rebase/squash/fixup, and history search (blame, bisect, log -S, reflog). Load before a task's first commit, push or worktree, or pass load_skills=['git'] to the task that commits. GitHub PRs, checks and merges: `github` skill. Triggers: 'commit', 'push', 'rebase', 'worktree', 'who wrote', 'when was X added'."

export function isGitSkillName(name: string): boolean {
  return resolveSkillAlias(name.toLowerCase()) === GIT_SKILL_NAME
}
