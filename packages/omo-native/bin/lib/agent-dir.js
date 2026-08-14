import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

/**
 * The one place that answers "where does omo keep engine state".
 *
 * Every omo entry point - the published launcher, `omo doctor`, `omo setup`, and the locally
 * installed launcher - MUST resolve the directory through this module. Each surface previously
 * carried its own default, so the product read three different directories depending on how it
 * was started, and an update that changed one of them looked exactly like erased settings.
 */

/** Env names carrying an explicit agent-state directory, most specific first. */
export const AGENT_DIR_ENV_NAMES = ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]

/** Marker proving the legacy flat directory was already inspected; written last. */
export const ADOPTION_MARKER = ".adopted-from-omo-flat"

/**
 * State files carried forward from the legacy flat layout. Deliberately an allowlist of small
 * configuration files: sessions, caches and logs stay where they are, so startup never turns into
 * an unbounded copy.
 */
export const ADOPTED_STATE_FILES = ["settings.json", "auth.json", "models.json", "models-store.json", "mcp.json", "trust.json"]

/** Windows launches carry the runtime home in the environment, which must outrank os.homedir. */
export function runtimeHome(env = process.env) {
  return env.HOME || env.USERPROFILE || homedir()
}

/** Where omo keeps engine state: an explicit override, otherwise the canonical branded location. */
export function canonicalAgentDir(env = process.env, home = runtimeHome(env)) {
  for (const name of AGENT_DIR_ENV_NAMES) {
    const configured = env[name]?.trim()
    if (configured) return resolve(configured)
  }
  return defaultAgentDir(home)
}

export function defaultAgentDir(home) {
  return join(home, ".omo", "agent")
}

/** Pre-unification layout: engine state written directly under the config directory. */
export function legacyFlatAgentDir(home) {
  return join(home, ".omo")
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "")
}

function readJsonFile(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    return parsed
  } catch {
    // A hand-edited settings file must never stop the agent from starting; leaving it unparsed
    // also leaves the marker unwritten, so a repaired file is still adopted on a later launch.
    return undefined
  }
}

/**
 * Backfills top-level keys the canonical settings file no longer has. Present keys are never
 * overwritten: the canonical file is always the newer truth, the flat file only fills its gaps.
 */
function backfillSettings(source, target) {
  const legacy = readJsonFile(source)
  const current = readJsonFile(target)
  if (!legacy || !current) return undefined

  const missing = Object.keys(legacy).filter((key) => !(key in current))
  if (missing.length === 0) return []

  copyFileSync(target, `${target}.bak-${timestamp()}`)
  const merged = { ...current }
  for (const key of missing) merged[key] = legacy[key]
  writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`)
  return missing
}

/**
 * One-time carry-forward from the legacy flat directory into the canonical one.
 *
 * Unifying the directory would otherwise present itself as one more reset to anyone whose state
 * still lives in the flat layout. Idempotent, never overwrites an existing canonical file, and
 * skipped entirely when the user pinned a directory of their own.
 */
/** @typedef {{ adopted: boolean, copied: string[], backfilled: string[] }} AdoptionResult */

/** @returns {AdoptionResult} */
export function adoptLegacyFlatState(env = process.env, home = runtimeHome(env)) {
  /** @type {AdoptionResult} */
  const result = { adopted: false, copied: [], backfilled: [] }
  const canonical = canonicalAgentDir(env, home)
  if (canonical !== defaultAgentDir(home)) return result

  const flat = legacyFlatAgentDir(home)
  if (!existsSync(flat)) return result
  if (existsSync(join(canonical, ADOPTION_MARKER))) return result

  let parseFailed = false
  for (const file of ADOPTED_STATE_FILES) {
    const source = join(flat, file)
    if (!existsSync(source)) continue
    const target = join(canonical, file)
    if (!existsSync(target)) {
      mkdirSync(canonical, { recursive: true })
      copyFileSync(source, target)
      result.copied.push(file)
      continue
    }
    if (file !== "settings.json") continue
    const backfilled = backfillSettings(source, target)
    if (backfilled === undefined) parseFailed = true
    else result.backfilled.push(...backfilled)
  }

  result.adopted = result.copied.length > 0 || result.backfilled.length > 0
  if (!parseFailed && (result.adopted || existsSync(canonical))) {
    mkdirSync(canonical, { recursive: true })
    writeFileSync(join(canonical, ADOPTION_MARKER), `${flat}\n`)
  }
  return result
}
