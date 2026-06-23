import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const CAPSOLVER_KEY_FILE = join(homedir(), ".config", "idm", "capsolver.key")

export function resolveCapsolverKey(): string | undefined {
  const fromEnv = process.env.CAPSOLVER_API_KEY?.trim()
  if (fromEnv) return fromEnv

  if (existsSync(CAPSOLVER_KEY_FILE)) {
    try {
      const fromFile = readFileSync(CAPSOLVER_KEY_FILE, "utf8").trim()
      if (fromFile) return fromFile
    } catch {
      void 0
    }
  }
  return undefined
}
