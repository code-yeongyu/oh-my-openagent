/**
 * Result from read_context tool
 */
export interface ReadContextResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Whether project context file exists */
  initialized: boolean
  /** The section that was requested (if not 'all') */
  section?: string
  /** The context data */
  context?: Record<string, unknown>
  /** Available sections in the context file */
  availableSections?: string[]
  /** Error message if failed */
  error?: string
}

/**
 * Available sections in project context
 */
export type ContextSection =
  | "all"
  | "project"
  | "tech_stack"
  | "architecture"
  | "integrations"
  | "conventions"

/**
 * Project context structure
 */
export interface ProjectContext {
  project?: {
    name?: string
    type?: string
    description?: string
  }
  tech_stack?: {
    languages?: string[]
    frameworks?: string[]
    databases?: string[]
  }
  architecture?: {
    pattern?: string
    layers?: string[]
  }
  integrations?: {
    linear?: {
      team?: string
      prefix?: string
    }
    mintlify?: {
      enabled?: boolean
    }
  }
  conventions?: {
    commit_format?: string
    branch_format?: string
  }
}
