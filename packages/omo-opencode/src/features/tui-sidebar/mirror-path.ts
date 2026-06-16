import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { MIRROR_DIR_NAME } from "./constants"

export function mirrorStorageDir(): string {
  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    "opencode",
    "storage",
    "oh-my-openagent",
    MIRROR_DIR_NAME,
  )
}

export function mirrorFilePath(projectDir: string): string {
  const projectHash = createHash("sha1").update(resolve(projectDir)).digest("hex").slice(0, 16)
  return join(mirrorStorageDir(), `${projectHash}.json`)
}
