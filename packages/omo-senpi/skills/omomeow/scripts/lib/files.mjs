import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

/** `scripts/` of the copy that is running (the skill itself, or the runtime copy under the state dir). */
export const SCRIPTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
export const SKILL_DIR = dirname(SCRIPTS_DIR)
export const CLI_PATH = join(SCRIPTS_DIR, "omomeow.mjs")

export function resolveHomeDir(env = process.env) {
  return env.HOME ?? env.USERPROFILE ?? homedir()
}

/** Per-user omomeow state: installed features, the owner, the session map, and nudge dedupe state. */
export function resolveStateDir(env = process.env) {
  if (env.OMOMEOW_HOME) return resolve(env.OMOMEOW_HOME)
  return join(resolveHomeDir(env), ".omo", "omomeow")
}

/**
 * The senpi agent directory whose `schedule/` the runner watches. An explicit override wins; inside a
 * session the session file path names it (`<agent dir>/sessions/...`), which covers both `~/.omo/agent`
 * (OmO Native) and `~/.senpi/agent` (plain senpi) without guessing.
 */
export function resolveAgentDir(env = process.env) {
  for (const key of ["SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]) {
    if (env[key]) return resolve(env[key])
  }
  const sessionFile = env.PI_SESSION_FILE
  if (sessionFile) {
    const marker = `${sep}sessions${sep}`
    const index = sessionFile.lastIndexOf(marker)
    if (index > 0) return sessionFile.slice(0, index)
  }
  return join(resolveHomeDir(env), ".senpi", "agent")
}

export function readJson(path, fallback) {
  let text
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return fallback
    throw error
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`)
  }
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}
