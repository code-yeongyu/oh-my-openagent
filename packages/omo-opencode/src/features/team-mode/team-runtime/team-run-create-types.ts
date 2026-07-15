export type SpawnedMemberResource = {
  taskId?: string
  worktreePath?: string
  ownedWorktreeRoot?: string
  worktreeOwnershipToken?: string
  worktreeCanonicalPath?: string
}

export type TeamRunCleanupReport = {
  cancelledTaskIds: string[]
  removedLayout: boolean
  removedWorktrees: string[]
  errors: string[]
}
