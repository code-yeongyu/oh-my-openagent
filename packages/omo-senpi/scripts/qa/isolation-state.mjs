import { createHash } from "node:crypto"
import { existsSync, opendirSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const CREDENTIAL_FILES = ["auth.json", "models.json", "settings.json", "trust.json"]
export const PROTECTED_STATE_FILES = ["auth.json", "settings.json", "models.json", "models-store.json", "trust.json", "hooks-state.json"]
export const OBSERVATION_LIMITS = { maxFiles: 10_000, maxBytes: 64 * 1024 * 1024, maxEntries: 20_000 }

export function credentialDigest(agentDir) {
  const hash = createHash("sha256")
  for (const name of CREDENTIAL_FILES) {
    const path = join(agentDir, name)
    hash.update(name)
    hash.update("\0")
    hash.update(existsSync(path) ? credentialBytes(path, name) : Buffer.from("absent"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function snapshotProtectedState(root) {
  return new Map(PROTECTED_STATE_FILES.map((name) => {
    const path = join(root, name)
    if (!existsSync(path)) return [name, "absent"]
    try {
      return [name, createHash("sha256").update(credentialBytes(path, name)).digest("hex")]
    } catch (error) {
      return [name, `error:${errorCode(error)}`]
    }
  }))
}

export function snapshotDirectory(root, limits = OBSERVATION_LIMITS) {
  if (!existsSync(root)) {
    return { snapshot: new Map(), complete: true, truncated: false, errors: [] }
  }
  const state = { root, files: [], errors: [], fileCount: 0, bytes: 0, entries: 0, truncated: false }
  collectFilesBounded(root, state, {
    maxFiles: limits.maxFiles,
    maxBytes: limits.maxBytes,
    maxEntries: limits.maxEntries ?? OBSERVATION_LIMITS.maxEntries,
  })
  const snapshot = new Map()
  for (const file of state.files.sort((left, right) => left.rel.localeCompare(right.rel))) {
    try {
      snapshot.set(file.rel, createHash("sha256").update(readFileSync(file.path)).digest("hex"))
    } catch (error) {
      state.errors.push(`${file.rel}: ${errorCode(error)}`)
    }
  }
  return {
    snapshot,
    complete: !state.truncated && state.errors.length === 0,
    truncated: state.truncated,
    errors: state.errors.sort(),
  }
}

export function changedSnapshotPaths(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort()
}

export function digestDirectory(root) {
  if (!existsSync(root)) return "absent"
  const files = []
  collectFiles(root, files)
  const hash = createHash("sha256")
  for (const file of files.sort()) {
    const rel = file.slice(root.length + 1)
    hash.update(rel)
    hash.update("\0")
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

function credentialBytes(path, name) {
  const content = readFileSync(path)
  if (name !== "settings.json") return content
  try {
    const settings = JSON.parse(content.toString("utf8"))
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return content
    delete settings.tipsHistory
    delete settings.lastChangelogVersion
    delete settings.modelLastOnThinkingLevels
    return JSON.stringify(settings)
  } catch {
    return content
  }
}

function collectFilesBounded(currentRoot, state, limits) {
  let directory
  try {
    directory = opendirSync(currentRoot)
  } catch (error) {
    state.errors.push(`${relative(state.root, currentRoot) || "."}: ${errorCode(error)}`)
    return
  }
  try {
    while (true) {
      const entry = directory.readSync()
      if (entry === null) break
      state.entries += 1
      if (state.entries > limits.maxEntries) {
        state.truncated = true
        return
      }
      const path = join(currentRoot, entry.name)
      if (entry.isDirectory()) {
        collectFilesBounded(path, state, limits)
        if (state.truncated) return
      } else if (entry.isFile()) {
        if (state.fileCount >= limits.maxFiles) {
          state.truncated = true
          return
        }
        try {
          const size = statSync(path).size
          if (state.bytes + size > limits.maxBytes) {
            state.truncated = true
            return
          }
          state.files.push({ path, rel: relative(state.root, path) })
          state.fileCount += 1
          state.bytes += size
        } catch (error) {
          state.errors.push(`${relative(state.root, path)}: ${errorCode(error)}`)
        }
      }
    }
  } catch (error) {
    state.errors.push(`${relative(state.root, currentRoot) || "."}: ${errorCode(error)}`)
  } finally {
    try {
      directory.closeSync()
    } catch (error) {
      state.errors.push(`${relative(state.root, currentRoot) || "."}: ${errorCode(error)}`)
    }
  }
}

function collectFiles(root, files) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectFiles(path, files)
    else if (entry.isFile()) files.push(path)
  }
}

function errorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN"
}
