export { OPENCODE_STORAGE, MESSAGE_STORAGE, PART_STORAGE } from "../../shared"

export const THINKING_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"])
export const META_TYPES = new Set(["step-start", "step-finish"])
export const CONTENT_TYPES = new Set(["text", "tool", "tool_use", "tool_result"])
