import { join } from "node:path"
import { getOpenCodeStorageDir } from "./data-path"

export const OPENCODE_STORAGE = getOpenCodeStorageDir()
export const MESSAGE_STORAGE = join(OPENCODE_STORAGE, "message")
export const PART_STORAGE = join(OPENCODE_STORAGE, "part")
export const SESSION_STORAGE = join(OPENCODE_STORAGE, "session")