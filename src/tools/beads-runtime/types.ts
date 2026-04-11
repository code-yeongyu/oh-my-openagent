export interface BeadsRuntimeAttachArgs {
  bead_id: string
  source_command: "start" | "resume"
  worktree_path?: string
  branch_name?: string
  worktree_name?: string
}
