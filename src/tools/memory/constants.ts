export const DEFAULT_MEMORY_PATH = "context/memory/"
export const MEMORY_FILE_EXTENSION = ".md"

export const ALLOWED_BASE_PATHS = [
  "context/",
  ".cursor/",
  ".opencode/",
  ".serena/",
  ".claude/",
]

export const TOOL_NAMES = {
  WRITE: "memory_write",
  READ: "memory_read",
  LIST: "memory_list",
  EDIT: "memory_edit",
  DELETE: "memory_delete",
} as const
