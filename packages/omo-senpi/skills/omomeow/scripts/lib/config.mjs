import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { resolveHomeDir } from "./files.mjs"

export const LANGUAGES = ["en", "ko"]
export const DEFAULT_SETTINGS = Object.freeze({
  language: "en",
  nudge: Object.freeze({ enabled: true, interval_minutes: 30 }),
})

/**
 * Remove `//` and `/* *\/` comments and trailing commas outside strings so `omo.jsonc` parses as JSON.
 * The omo loader uses jsonc-parser; the skill scripts ship without dependencies, so they carry this
 * small equivalent for the one section they read.
 */
export function stripJsonc(text) {
  let out = ""
  let index = 0
  let inString = false
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (inString) {
      out += char
      if (char === "\\") {
        out += next ?? ""
        index += 2
        continue
      }
      if (char === '"') inString = false
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      index += 1
      continue
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1
      continue
    }
    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2)
      index = end === -1 ? text.length : end + 2
      continue
    }
    out += char
    index += 1
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function realOrSelf(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function configFileIn(omoDir) {
  for (const name of ["omo.jsonc", "omo.json"]) {
    const path = join(omoDir, name)
    if (existsSync(path)) return path
  }
  return null
}

/**
 * Same layer order as omo-config-core `resolveOmoConfigPaths`: the user layer `~/.omo/omo.json[c]`, then
 * project layers `<dir>/.omo/omo.json[c]` from the farthest ancestor below `$HOME` down to `cwd`.
 * Symlinked project `.omo` dirs and files are refused, as the omo loader does.
 */
export function configLayerPaths({ cwd, env = process.env }) {
  const home = resolve(resolveHomeDir(env))
  const realHome = realOrSelf(home)
  const layers = []
  const userPath = configFileIn(join(home, ".omo"))
  if (userPath !== null) layers.push({ scope: "user", path: userPath })

  const nearestFirst = []
  let current = resolve(cwd)
  for (let depth = 0; depth < 256; depth += 1) {
    if (current === home || realOrSelf(current) === realHome) break
    const omoDir = join(current, ".omo")
    if (!isSymlink(omoDir)) {
      const path = configFileIn(omoDir)
      if (path !== null && !isSymlink(path)) nearestFirst.push({ scope: "project", path })
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return [...layers, ...nearestFirst.reverse()]
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Resolve the `omomeow` section of the merged omo.json layers, with defaults and per-key diagnostics. */
export function loadOmoMeowSettings({ cwd = process.cwd(), env = process.env } = {}) {
  const diagnostics = []
  const sources = []
  const merged = { nudge: {} }
  for (const layer of configLayerPaths({ cwd, env })) {
    let parsed
    try {
      parsed = JSON.parse(stripJsonc(readFileSync(layer.path, "utf8")))
    } catch (error) {
      diagnostics.push(`${layer.path}: ${error.message}`)
      continue
    }
    const section = isPlainObject(parsed) ? parsed.omomeow : undefined
    if (section === undefined) continue
    if (!isPlainObject(section)) {
      diagnostics.push(`${layer.path}: omomeow must be an object`)
      continue
    }
    sources.push(layer.path)
    if (section.language !== undefined) merged.language = section.language
    if (isPlainObject(section.nudge)) Object.assign(merged.nudge, section.nudge)
  }

  const settings = {
    language: DEFAULT_SETTINGS.language,
    nudge: { ...DEFAULT_SETTINGS.nudge },
  }
  if (merged.language !== undefined) {
    if (LANGUAGES.includes(merged.language)) settings.language = merged.language
    else diagnostics.push(`omomeow.language must be one of ${LANGUAGES.join(", ")}; using "${settings.language}"`)
  }
  if (merged.nudge.enabled !== undefined) {
    if (typeof merged.nudge.enabled === "boolean") settings.nudge.enabled = merged.nudge.enabled
    else diagnostics.push("omomeow.nudge.enabled must be a boolean; using true")
  }
  if (merged.nudge.interval_minutes !== undefined) {
    const minutes = merged.nudge.interval_minutes
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440) settings.nudge.interval_minutes = minutes
    else diagnostics.push("omomeow.nudge.interval_minutes must be an integer from 1 to 1440; using 30")
  }
  return { settings, sources, diagnostics }
}

export function getSettingPath(settings, path) {
  let value = settings
  for (const key of path.split(".")) {
    if (!isPlainObject(value)) return undefined
    value = value[key]
  }
  return value
}
