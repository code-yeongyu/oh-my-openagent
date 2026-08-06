import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
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

export function canonicalProjectDir(projectDir: string): string {
  try {
    return realpathSync.native(projectDir)
  } catch (error) {
    if (error instanceof Error) {
      return resolve(projectDir)
    }
    throw error
  }
}

export function mirrorFilePath(projectDir: string): string {
  const projectHash = createHash("sha1").update(canonicalProjectDir(projectDir)).digest("hex").slice(0, 16)
  return join(mirrorStorageDir(), `${projectHash}.json`)
}
