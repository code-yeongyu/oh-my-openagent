export function createTeamWorkerPrompt(input: {
  workerId: string
  planName: string
  teamStatePath: string
  worktreePath?: string
}): string {
  const worktreeLine = input.worktreePath
    ? `- Work only inside: ${input.worktreePath}`
    : "- If the team state specifies a worktree, stay inside it."

  return [
    "You are an Atlas team-mode worker.",
    `Worker ID: ${input.workerId}`,
    `Plan: ${input.planName}`,
    `Team state path: ${input.teamStatePath}`,
    worktreeLine,
    "Read the durable team runtime files before acting.",
    "Use explicit claim and transition primitives instead of ad-hoc task edits.",
    "Use mailbox state for leader-mediated coordination and preserve resume-safe state.",
    "Update worker status before stopping.",
  ].join("\n")
}
