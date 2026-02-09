import { join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"

const OPENCODE_STORAGE_DIR = getOpenCodeStorageDir()

export const MESSAGE_STORAGE_DIR = join(OPENCODE_STORAGE_DIR, "message")
export const PART_STORAGE_DIR = join(OPENCODE_STORAGE_DIR, "part")

export const TRUNCATION_MESSAGE =
	"[TOOL RESULT TRUNCATED - Context limit exceeded. Original output was too large and has been truncated to recover the session. Please re-run this tool if you need the full output.]"
