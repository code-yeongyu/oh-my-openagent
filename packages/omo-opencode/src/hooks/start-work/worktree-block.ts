export function createWorktreeActiveBlock(worktreePath: string): string {
  return `
## Worktree Active

**Worktree**: \`${worktreePath}\`

**CRITICAL - DO NOT FORGET**: You are working inside a git worktree. ALL operations MUST be performed exclusively within this worktree directory.
- Every file read, write, edit, and git operation MUST target paths under: \`${worktreePath}\`
- When delegating tasks to subagents, you MUST include the worktree path in your delegation prompt so they also operate exclusively within the worktree
- NEVER operate on the main repository directory - always use the worktree path above`
}

export interface PrDeliveryFlags {
  readonly makePr: boolean
  readonly ship: boolean
}

export function createPrDeliveryBlock(flags: PrDeliveryFlags, worktreePath: string | undefined): string {
  if (!flags.makePr && !flags.ship) return ""

  const worktreeInstruction = worktreePath
    ? `- Work exclusively inside the active worktree above; never touch the main repository directory.`
    : `- Worktree mode is IMPLIED: BEFORE any implementation, create a task-owned worktree (\`git worktree add <absolute-path> <base-branch>\`), record it in boulder.json as \`"worktree_path"\`, and perform ALL work inside it.`

  const completionInstruction = flags.ship
    ? `- Then stay on the job until the PR is MERGED: watch CI and review gates, fix failures and address feedback inside the worktree (capture fresh QA evidence for behavior changes), merge per the repository's merge policy once green, then remove the worktree and sync \`.omo/\` state back to the main repo.`
    : `- Hand off with the PR URL after it is created. Do not merge unless the user explicitly asks.`

  const heading = flags.ship ? "## PR Delivery Mode (--ship: work until merged)" : "## PR Delivery Mode (--make-pr)"

  return `\n${heading}\n\nDeliver this work as a pull request.\n${worktreeInstruction}\n- On completion: commit, push the branch, and open a reviewer-readable PR (plain-language summary, changes grouped by area, QA evidence with artifact paths, risks).\n${completionInstruction}`
}
