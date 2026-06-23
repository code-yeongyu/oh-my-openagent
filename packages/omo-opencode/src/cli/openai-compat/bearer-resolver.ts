import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { join, dirname } from "node:path"
import { homedir } from "node:os"

const ENV_KEY = "IDM_OPENAI_COMPAT_BEARER"
const SECRET_FILE = join(homedir(), ".config/idm/openai-compat.bearer")
const SECRET_FILE_ENV = "IDM_OPENAI_COMPAT_BEARER_FILE"

export type BearerSource = "explicit" | "env" | "file" | "generated"

export type ResolvedBearer = {
  token: string
  source: BearerSource
  filePath?: string
}

export function bearerSecretPath(): string {
  return process.env[SECRET_FILE_ENV] ?? SECRET_FILE
}

export function resolveBearer(explicit?: string): ResolvedBearer {
  if (explicit && explicit.length > 0) {
    return { token: explicit, source: "explicit" }
  }
  const fromEnv = process.env[ENV_KEY]
  if (fromEnv && fromEnv.length > 0) {
    return { token: fromEnv, source: "env" }
  }
  const path = bearerSecretPath()
  if (existsSync(path)) {
    const token = readFileSync(path, "utf8").trim()
    if (token.length > 0) {
      return { token, source: "file", filePath: path }
    }
  }
  const generated = generateAndPersist(path)
  return { token: generated, source: "generated", filePath: path }
}

function generateAndPersist(path: string): string {
  const token = `sk-idm-${randomBytes(32).toString("hex")}`
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, token + "\n", { mode: 0o600 })
  chmodSync(path, 0o600)
  return token
}
