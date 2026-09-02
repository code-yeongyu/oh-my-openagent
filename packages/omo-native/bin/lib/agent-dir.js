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

/** Keys that must never be copied between state objects, whatever a legacy file contains. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"])

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Recursively copies properties the canonical object is missing. Present values are never
 * overwritten: the canonical file is always the newer truth, the flat file only fills its
 * gaps. Objects recurse so partially overlapping subtrees keep their missing leaves; arrays,
 * scalars and nulls never merge element-wise. Returns the number of properties copied and
 * collects the top-level keys that gained additions into `touched`.
 */
function mergeMissing(source, target, touched, owner = null) {
  let copied = 0
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue
    const value = source[key]
    const topKey = owner ?? key
    if (!(key in target)) {
      target[key] = value
      touched.add(topKey)
      copied += 1
      continue
    }
    if (isPlainObject(value) && isPlainObject(target[key])) {
      copied += mergeMissing(value, target[key], touched, topKey)
    }
  }
  return copied
}

/**
 * Backfills properties an existing canonical state file is missing. Present values are never
 * overwritten: the canonical file is always the newer truth, the flat file only fills its gaps.
 * Returns the touched top-level keys, or undefined when either side cannot be parsed - leaving
 * the marker unwritten, so a repaired file is still adopted on a later launch.
 */
function backfillJsonObject(source, target) {
  const legacy = readJsonFile(source)
  const current = readJsonFile(target)
  if (!legacy || !current) return undefined

  const touched = new Set()
  if (mergeMissing(legacy, current, touched) === 0) return []

  copyFileSync(target, `${target}.bak-${timestamp()}`)
  writeFileSync(target, `${JSON.stringify(current, null, 2)}\n`)
  return [...touched]
}

/**
 * One-time carry-forward from the legacy flat directory into the canonical one.
 *
 * Unifying the directory would otherwise present itself as one more reset to anyone whose state
 * still lives in the flat layout. Idempotent, never overwrites an existing canonical file or
 * value: when a canonical file already exists its missing entries - at any depth for objects -
 * are merged in instead, so credentials adopted before the runtime created its own files are
 * never dropped. Skipped entirely when the user pinned a directory of their own.
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
    const backfilled = backfillJsonObject(source, target)
    if (backfilled === undefined) parseFailed = true
    else if (file === "settings.json") result.backfilled.push(...backfilled)
    else result.backfilled.push(...backfilled.map((key) => `${file}:${key}`))
  }

  result.adopted = result.copied.length > 0 || result.backfilled.length > 0
  if (!parseFailed && (result.adopted || existsSync(canonical))) {
    mkdirSync(canonical, { recursive: true })
    writeFileSync(join(canonical, ADOPTION_MARKER), `${flat}\n`)
  }
  return result
}
