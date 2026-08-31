import { createHash } from "node:crypto"
import { closeSync, existsSync, fstatSync, openSync, opendirSync, readFileSync, readSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const CREDENTIAL_FILES = ["auth.json", "models.json", "settings.json", "trust.json"]
export const PROTECTED_STATE_FILES = ["auth.json", "settings.json", "models.json", "models-store.json", "trust.json", "hooks-state.json"]
export const OBSERVATION_LIMITS = { maxFiles: 10_000, maxBytes: 64 * 1024 * 1024, maxEntries: 20_000 }
const FILE_IO = { closeSync, fstatSync, openSync, readSync, statSync }
const HASH_CHUNK_BYTES = 64 * 1024

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

export function snapshotProtectedState(root, readFile = readFileSync) {
  const snapshot = new Map()
  const errors = []
  for (const name of PROTECTED_STATE_FILES) {
    const path = join(root, name)
    if (!existsSync(path)) {
      snapshot.set(name, "absent")
      continue
    }
    try {
      snapshot.set(name, createHash("sha256").update(credentialBytes(path, name, readFile)).digest("hex"))
    } catch (error) {
      errors.push({ path: name, code: errorCode(error) })
    }
  }
  return { snapshot, complete: errors.length === 0, errors }
}

export function protectedSnapshotsUntouched(before, after) {
  return before.complete && after.complete && changedSnapshotPaths(before.snapshot, after.snapshot).length === 0
}

export function snapshotDirectory(root, limits = OBSERVATION_LIMITS, io = FILE_IO) {
  if (!existsSync(root)) {
    return { snapshot: new Map(), complete: true, truncated: false, errors: [], bytesRead: 0 }
  }
  const state = { root, files: [], errors: [], entries: 0, truncated: false }
  collectFilesBounded(root, state, {
    maxFiles: limits.maxFiles,
    maxEntries: limits.maxEntries ?? OBSERVATION_LIMITS.maxEntries,
  })
  const snapshot = new Map()
  let bytesRead = 0
  for (const file of state.files.sort((left, right) => left.rel.localeCompare(right.rel))) {
    const remainingBytes = limits.maxBytes - bytesRead
    if (file.size > remainingBytes) {
      state.truncated = true
      break
    }
    const result = hashFileBounded(file, remainingBytes, io)
    bytesRead += result.bytesRead
    if (result.error !== undefined) {
      state.errors.push({ path: file.rel, code: result.error })
      continue
    }
    snapshot.set(file.rel, result.digest)
  }
  return {
    snapshot,
    complete: !state.truncated && state.errors.length === 0,
    truncated: state.truncated,
    errors: state.errors.sort(compareSnapshotErrors),
    bytesRead,
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

function credentialBytes(path, name, readFile = readFileSync) {
  const content = readFile(path)
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
    state.errors.push({ path: relative(state.root, currentRoot) || ".", code: errorCode(error) })
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
        if (state.files.length >= limits.maxFiles) {
          state.truncated = true
          return
        }
        try {
          const stat = statSync(path)
          state.files.push({ path, rel: relative(state.root, path), size: stat.size, dev: stat.dev, ino: stat.ino })
        } catch (error) {
          state.errors.push({ path: relative(state.root, path), code: errorCode(error) })
        }
      }
    }
  } catch (error) {
    state.errors.push({ path: relative(state.root, currentRoot) || ".", code: errorCode(error) })
  } finally {
    try {
      directory.closeSync()
    } catch (error) {
      state.errors.push({ path: relative(state.root, currentRoot) || ".", code: errorCode(error) })
    }
  }
}

function hashFileBounded(file, remainingBytes, io) {
  if (file.size > remainingBytes) return { bytesRead: 0, error: "BYTE_LIMIT" }
  let fd
  let bytesRead = 0
  let result
  try {
    fd = io.openSync(file.path, "r")
    const opened = io.fstatSync(fd)
    if (opened.dev !== file.dev || opened.ino !== file.ino) return { bytesRead, error: "FILE_REPLACED" }
    if (opened.size !== file.size) return { bytesRead, error: "FILE_CHANGED" }
    const hash = createHash("sha256")
    const buffer = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, Math.max(file.size, 1)))
    while (bytesRead < file.size) {
      const requested = Math.min(buffer.length, file.size - bytesRead, remainingBytes - bytesRead)
      if (requested <= 0) return { bytesRead, error: "BYTE_LIMIT" }
      let count
      try {
        count = io.readSync(fd, buffer, 0, requested, bytesRead)
      } catch (error) {
        if (io.fstatSync(fd).size < file.size) return { bytesRead, error: "SHORT_READ" }
        return { bytesRead, error: errorCode(error) }
      }
      if (count === 0) return { bytesRead, error: "SHORT_READ" }
      hash.update(buffer.subarray(0, count))
      bytesRead += count
    }
    const finished = io.fstatSync(fd)
    if (finished.dev !== file.dev || finished.ino !== file.ino || finished.size !== file.size) {
      return { bytesRead, error: "FILE_CHANGED" }
    }
    const pathStat = io.statSync(file.path)
    if (pathStat.dev !== file.dev || pathStat.ino !== file.ino) return { bytesRead, error: "FILE_REPLACED" }
    if (pathStat.size !== file.size) return { bytesRead, error: "FILE_CHANGED" }
    result = { bytesRead, digest: hash.digest("hex") }
  } catch (error) {
    result = { bytesRead, error: errorCode(error) }
  } finally {
    if (fd !== undefined) {
      try {
        io.closeSync(fd)
      } catch (error) {
        result = { bytesRead, error: errorCode(error) }
      }
    }
  }
  return result
}

function compareSnapshotErrors(left, right) {
  return left.path.localeCompare(right.path) || left.code.localeCompare(right.code)
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
