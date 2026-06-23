import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const SMAILPRO_KEY_FILE = join(homedir(), ".config", "idm", "smailpro.key")

export function resolveSmailProKey(): string | undefined {
  const fromEnv = process.env.SMAILPRO_API_KEY?.trim() ?? process.env.SONJJ_API_KEY?.trim()
  if (fromEnv) return fromEnv

  if (existsSync(SMAILPRO_KEY_FILE)) {
    try {
      const fromFile = readFileSync(SMAILPRO_KEY_FILE, "utf8").trim()
      if (fromFile) return fromFile
    } catch {
      void 0
    }
  }
  return undefined
}
