import { join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"

export const OPENCODE_STORAGE = getOpenCodeStorageDir()
export const MESSAGE_STORAGE = join(OPENCODE_STORAGE, "message")
export const PART_STORAGE = join(OPENCODE_STORAGE, "part")

export const THINKING_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"])
export const META_TYPES = new Set(["step-start", "step-finish"])
export const CONTENT_TYPES = new Set(["text", "tool", "tool_use", "tool_result"])
