/**
 * Result from create_spec_folder tool
 */
export interface CreateSpecFolderResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The created folder path (relative to base) */
  path?: string
  /** The absolute folder path */
  fullPath?: string
  /** The folder ID (e.g., LIF-123-feat-user-auth) */
  folderId?: string
  /** List of created files */
  createdFiles?: string[]
  /** Base path if worktree was used */
  basePath?: string
  /** Human-readable success message */
  message: string
  /** Error message if failed */
  error?: string
}

/**
 * Spec folder type
 */
export type SpecType = "feat" | "fix" | "chore" | "refactor" | "docs" | "infra"

/**
 * Template files to create in spec folder
 */
export const SPEC_TEMPLATE_FILES = [
  "spec.md",
  "plan.md",
  "tasks.md",
  "status.md",
]

/**
 * Default spec folder base path
 */
export const DEFAULT_SPEC_BASE_PATH = "context/specs"

export const SPEC_BASE_PATHS = [
  "context/specs",
  ".cursor/specs",
]

export interface UpdateWorkflowStateResult {
  success: boolean
  specPath: string
  step: string
  previousStep?: string
  completedSteps: string[]
  message: string
  error?: string
}
