export type TeamRunCleanupReport = {
  cancelledTaskIds: string[]
  removedLayout: boolean
  removedWorktrees: string[]
  errors: string[]
}

export class TeamRunCreateError extends Error {
  constructor(
    message: string,
    public readonly cleanupReport: TeamRunCleanupReport,
    cause: Error,
  ) {
    super(`${message}: ${cause.message}`)
    this.name = "TeamRunCreateError"
    this.cause = cause
  }
}
