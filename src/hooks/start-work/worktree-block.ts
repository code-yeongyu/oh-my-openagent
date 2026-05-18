export function createWorktreeActiveBlock(worktreePath: string): string {
  return `
## Worktree Active

**Worktree**: \`${worktreePath}\`

**CRITICAL - DO NOT FORGET**: You are working inside a git worktree. ALL operations MUST be performed exclusively within this worktree directory.
- Every file read, write, edit, and git operation MUST target paths under: \`${worktreePath}\`
- When delegating tasks to subagents, you MUST include the worktree path in your delegation prompt so they also operate exclusively within the worktree
- NEVER operate on the main repository directory - always use the worktree path above`
}
