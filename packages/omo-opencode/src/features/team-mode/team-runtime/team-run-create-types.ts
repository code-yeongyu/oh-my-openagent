export type SpawnedMemberResource = {
  taskId?: string
  worktreePath?: string
  ownedWorktreeRoot?: string
}

export type TeamRunCleanupReport = {
  cancelledTaskIds: string[]
  removedLayout: boolean
  removedWorktrees: string[]
  errors: string[]
}
