import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import {
  errorCode,
  FILE_IO,
  fileMetadata,
  hashFileBounded,
  isTransientSnapshotEntryError,
  readProtectedFileStable,
} from "./isolation-file-readers.mjs"

const CREDENTIAL_FILES = ["auth.json", "models.json", "settings.json", "trust.json"]
export const PROTECTED_STATE_FILES = ["auth.json", "settings.json", "models.json", "models-store.json", "trust.json", "hooks-state.json"]
export const OBSERVATION_LIMITS = { maxFiles: 10_000, maxBytes: 64 * 1024 * 1024, maxEntries: 20_000 }

export function credentialDigest(agentDir, { readFile = readFileSync } = {}) {
  const hash = createHash("sha256")
  for (const name of CREDENTIAL_FILES) {
    let content
    try {
      content = credentialBytes(readFile(join(agentDir, name)), name)
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
      content = Buffer.from("absent")
    }
    hash.update(name)
    hash.update("\0")
    hash.update(content)
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function snapshotProtectedState(root, readFileOrIo = FILE_IO) {
  const io = protectedFileIo(readFileOrIo)
  const snapshot = new Map()
  const errors = []
  for (const name of PROTECTED_STATE_FILES) {
    const result = readProtectedFileStable(join(root, name), io)
    if (result.error !== undefined) errors.push({ path: name, code: result.error })
    else if (result.absent) snapshot.set(name, "absent")
    else snapshot.set(name, createHash("sha256").update(credentialBytes(result.content, name)).digest("hex"))
  }
  return { snapshot, complete: errors.length === 0, errors }
}

export function protectedSnapshotsUntouched(before, after) {
  return before.complete && after.complete && changedSnapshotPaths(before.snapshot, after.snapshot).length === 0
}

export function snapshotDirectory(root, limits = OBSERVATION_LIMITS, ioOverrides = {}) {
  const io = { ...FILE_IO, ...ioOverrides }
  const state = { root, files: [], errors: [], entries: 0, truncated: false }
  collectFilesBounded(root, state, {
    maxFiles: limits.maxFiles,
    maxEntries: limits.maxEntries ?? OBSERVATION_LIMITS.maxEntries,
  }, io)
  const snapshot = new Map()
  let bytesRead = 0
  for (const file of state.files.sort((left, right) => left.rel.localeCompare(right.rel))) {
    const remainingBytes = limits.maxBytes - bytesRead
    if (file.size > remainingBytes) {
      state.truncated = true
      break
    }
    const result = hashFileBounded(file, remainingBytes, io, credentialBytes)
    bytesRead += result.bytesRead
    if (result.error !== undefined) {
      if (!isTransientSnapshotEntryError({ code: result.error })) state.errors.push({ path: file.rel, code: result.error })
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
    .map(canonicalRelativePath)
    .sort()
}

export function classifyObservedChanges(paths) {
  const volatile = new Set()
  const protectedState = new Set()
  const other = new Set()
  for (const rawPath of paths) {
    const path = canonicalRelativePath(rawPath)
    if (path.startsWith("sessions/") || path.startsWith("cache/") || path.startsWith("logs/") || path.endsWith(".log")) volatile.add(path)
    else if (PROTECTED_STATE_FILES.includes(path)) protectedState.add(path)
    else other.add(path)
  }
  return {
    volatile: [...volatile].sort(),
    protectedState: [...protectedState].sort(),
    other: [...other].sort(),
  }
}

export function isolationVerdict(beforeProtected, afterProtected, observedChangedPaths) {
  const directProtected = changedSnapshotPaths(beforeProtected.snapshot, afterProtected.snapshot)
  const observed = classifyObservedChanges(observedChangedPaths)
  const changedPaths = [...new Set([...directProtected, ...observed.protectedState, ...observed.other])].sort()
  return {
    changedPaths,
    untouched: beforeProtected.complete && afterProtected.complete && changedPaths.length === 0,
  }
}

export function digestDirectory(root, { readdir = readdirSync, readFile = readFileSync } = {}) {
  const files = []
  if (!collectFiles(root, files, readdir, true)) return "absent"
  const hash = createHash("sha256")
  for (const file of files.sort()) {
    const rel = canonicalRelativePath(file.slice(root.length + 1))
    try {
      const fileDigest = createHash("sha256").update(readFile(file)).digest("hex")
      hash.update(rel)
      hash.update("\0")
      hash.update(fileDigest)
      hash.update("\0")
    } catch (error) {
      if (!isTransientSnapshotEntryError(error)) throw error
    }
  }
  return hash.digest("hex")
}

function credentialBytes(content, name) {
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

function collectFilesBounded(currentRoot, state, limits, io) {
  let directory
  try {
    directory = io.opendirSync(currentRoot)
  } catch (error) {
    if (!isTransientSnapshotEntryError(error)) {
      state.errors.push({ path: canonicalRelativePath(relative(state.root, currentRoot) || "."), code: errorCode(error) })
    }
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
        collectFilesBounded(path, state, limits, io)
        if (state.truncated) return
      } else if (entry.isFile()) {
        if (state.files.length >= limits.maxFiles) {
          state.truncated = true
          return
        }
        try {
          const metadata = fileMetadata(io.statSync(path, { bigint: true }))
          state.files.push({
            path,
            rel: canonicalRelativePath(relative(state.root, path)),
            size: boundedSize(metadata.size),
            metadata,
          })
        } catch (error) {
          if (!isTransientSnapshotEntryError(error)) {
            state.errors.push({ path: canonicalRelativePath(relative(state.root, path)), code: errorCode(error) })
          }
        }
      }
    }
  } catch (error) {
    state.errors.push({ path: canonicalRelativePath(relative(state.root, currentRoot) || "."), code: errorCode(error) })
  } finally {
    try {
      directory.closeSync()
    } catch (error) {
      state.errors.push({ path: canonicalRelativePath(relative(state.root, currentRoot) || "."), code: errorCode(error) })
    }
  }
}

function protectedFileIo(readFileOrIo) {
  if (typeof readFileOrIo === "function") {
    return { ...FILE_IO, ...Object.fromEntries(Object.entries(readFileOrIo)), readFileSync: readFileOrIo }
  }
  return { ...FILE_IO, ...readFileOrIo }
}

function boundedSize(size) {
  return size > BigInt(Number.MAX_SAFE_INTEGER) ? Number.POSITIVE_INFINITY : Number(size)
}

function compareSnapshotErrors(left, right) {
  return left.path.localeCompare(right.path) || left.code.localeCompare(right.code)
}

function collectFiles(root, files, readdir, isRoot = false) {
  let entries
  try {
    entries = readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isTransientSnapshotEntryError(error)) return !isRoot
    throw error
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectFiles(path, files, readdir)
    else if (entry.isFile()) files.push(path)
  }
  return true
}

function canonicalRelativePath(path) {
  return path.replaceAll("\\", "/")
}
