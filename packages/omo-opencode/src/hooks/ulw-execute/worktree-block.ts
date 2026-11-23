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

/** `--light` (#14388): keep the plan, drop the per-step ceremony, verify once at the end. */
export function createLightProfileBlock(): string {
  return `
## Light Profile (--light)

Keep the plan, Boulder state, goal, todos and delegation. Drop the per-step ceremony:
- ONE worktree for the whole plan: create it once (or use \`--worktree\`) and run every wave in it; no per-wave or per-lane worktrees, and under \`--make-pr\`/\`--ship\` one PR for the whole plan.
- No per-checkbox gates: a checkbox is \`[x]\` when its worker reports done with its own tests passing. No per-checkbox adversarial verifier, no adversarial-class probes, no per-step ledger receipts or evidence files.
- Verify ONCE at the end: after the last checkbox, one worker runs the plan's verification commands and one real-surface QA against the plan's acceptance criteria, captured as one artifact. The ledger holds only a \`run-start\` entry with \`"profile": "light"\` and that one \`final-verification\` entry. A failed final pass goes back to workers and runs again; stop after the same failure twice or three failed passes.`
}
