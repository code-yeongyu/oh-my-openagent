// Dependency-free so the manager can name a member's own tools without loading the member extension.
export const MEMBER_TASK_SEND_TOOL_NAME = "task_send"

/** Every tool the member extension registers in a member process. A member keeps them under any agent allow list. */
export const MEMBER_EXTENSION_TOOL_NAMES: readonly string[] = [MEMBER_TASK_SEND_TOOL_NAME]
