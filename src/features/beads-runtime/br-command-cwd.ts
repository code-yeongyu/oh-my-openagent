export interface BeadsRuntimeCommandCwdSource {
  bead_worktree_path?: string
  worktree_path?: string
}

function normalizePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function resolveBeadsRuntimeCommandCwd(args: {
  directory: string
  state?: BeadsRuntimeCommandCwdSource | null
  worktreePath?: string
}): string {
  return normalizePath(args.worktreePath)
    ?? normalizePath(args.state?.bead_worktree_path)
    ?? normalizePath(args.state?.worktree_path)
    ?? args.directory
}
