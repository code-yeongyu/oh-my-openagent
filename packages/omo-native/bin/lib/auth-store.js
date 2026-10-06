/**
 * Read and write the engine's `<agentDir>/auth.json`: every setup stage that imports a key goes
 * through here, so they all escape, back up and write it the same way.
 */

import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

// opencode keeps a pasted key verbatim and never interprets it, but the engine resolves every stored
// key as a config value: a leading `!` runs a shell command and `$NAME` / `${NAME}` interpolate the
// environment. `$$` and `$!` are the engine's literal escapes, so the engine reads back the exact
// bytes opencode held.
export function literalConfigValue(value) {
  return value.replace(/[$!]/g, "$$$&")
}

export function readAuthStore(path) {
  if (!existsSync(path)) return { entries: {}, bytes: undefined }
  const bytes = readFileSync(path, "utf8")
  try {
    const entries = JSON.parse(bytes)
    if (entries === null || typeof entries !== "object" || Array.isArray(entries)) throw new Error("expected object")
    return { entries, bytes }
  } catch {
    return { malformed: true, bytes }
  }
}

export function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "")
}

// The credential and custom-provider stages of one run can both rewrite auth.json within the same
// millisecond. The first backup holds the older bytes, so a later one never replaces it.
function backup(path) {
  try {
    copyFileSync(path, `${path}.bak-${timestamp()}`, constants.COPYFILE_EXCL)
  } catch (error) {
    if (error.code !== "EEXIST") throw error
  }
}

export function writeAuthStore(path, current, additions) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (current.bytes !== undefined) backup(path)
  const next = { ...current.entries }
  for (const item of additions) next[item.provider] = { type: "api_key", key: item.key }
  const temporary = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}
