import { join } from "node:path"
import { homedir } from "node:os"

const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")

export const OPENCODE_STORAGE = join(xdgData, "opencode", "storage")
export const MESSAGE_STORAGE = join(OPENCODE_STORAGE, "message")
export const PART_STORAGE = join(OPENCODE_STORAGE, "part")
