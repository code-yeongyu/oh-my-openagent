import { createHash } from "node:crypto"
import { closeSync, existsSync, fstatSync, openSync, opendirSync, readFileSync, readSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const CREDENTIAL_FILES = ["auth.json", "models.json", "settings.json", "trust.json"]
export const PROTECTED_STATE_FILES = ["auth.json", "settings.json", "models.json", "models-store.json", "trust.json", "hooks-state.json"]
export const OBSERVATION_LIMITS = { maxFiles: 10_000, maxBytes: 64 * 1024 * 1024, maxEntries: 20_000 }
const FILE_IO = { closeSync, fstatSync, openSync, opendirSync, readFileSync, readSync, statSync }
const HASH_CHUNK_BYTES = 64 * 1024

export function credentialDigest(agentDir) {
  const hash = createHash("sha256")
  for (const name of CREDENTIAL_FILES) {
    const path = join(agentDir, name)
    hash.update(name)
    hash.update("\0")
    hash.update(existsSync(path) ? credentialBytes(readFileSync(path), name) : Buffer.from("absent"))
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
  if (!existsSync(root)) {
    return { snapshot: new Map(), complete: true, truncated: false, errors: [], bytesRead: 0 }
  }
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
    const result = hashFileBounded(file, remainingBytes, io)
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
    .sort()
}

export function classifyObservedChanges(paths) {
  const volatile = []
  const protectedState = []
  const other = []
  for (const path of paths) {
    if (path.startsWith("sessions/") || path.startsWith("cache/") || path.startsWith("logs/") || path.endsWith(".log")) volatile.push(path)
    else if (PROTECTED_STATE_FILES.includes(path)) protectedState.push(path)
    else other.push(path)
  }
  return { volatile, protectedState, other }
}

export function digestDirectory(root, { readdir = readdirSync, readFile = readFileSync } = {}) {
  if (!existsSync(root)) return "absent"
  const files = []
  collectFiles(root, files, readdir)
  const hash = createHash("sha256")
  for (const file of files.sort()) {
    const rel = file.slice(root.length + 1)
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
    if (!isTransientSnapshotEntryError(error)) state.errors.push({ path: relative(state.root, currentRoot) || ".", code: errorCode(error) })
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
          state.files.push({ path, rel: relative(state.root, path), size: boundedSize(metadata.size), metadata })
        } catch (error) {
          if (!isTransientSnapshotEntryError(error)) state.errors.push({ path: relative(state.root, path), code: errorCode(error) })
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
  let fd
  let bytesRead = 0
  let result
  try {
    fd = io.openSync(file.path, "r")
    const opened = fileMetadata(io.fstatSync(fd, { bigint: true }))
    const openingError = changedMetadataCode(file.metadata, opened)
    if (openingError !== undefined) {
      const openingPath = fileMetadata(io.statSync(file.path, { bigint: true }))
      if (!sameIdentity(opened, openingPath)) throw snapshotError("FILE_REPLACED")
      throw snapshotError(openingError)
    }
    const hash = createHash("sha256")
    const settingsChunks = file.rel === "settings.json" ? [] : undefined
    const buffer = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, Math.max(file.size, 1)))
    while (bytesRead < file.size) {
      const requested = Math.min(buffer.length, file.size - bytesRead, remainingBytes - bytesRead)
      let count
      try {
        count = io.readSync(fd, buffer, 0, requested, bytesRead)
      } catch (error) {
        if (fileMetadata(io.fstatSync(fd, { bigint: true })).size < file.metadata.size) throw snapshotError("SHORT_READ")
        throw error
      }
      if (count === 0) throw snapshotError("SHORT_READ")
      const chunk = buffer.subarray(0, count)
      hash.update(chunk)
      if (settingsChunks !== undefined) settingsChunks.push(Buffer.from(chunk))
      bytesRead += count
    }
    const finished = fileMetadata(io.fstatSync(fd, { bigint: true }))
    const pathMetadata = fileMetadata(io.statSync(file.path, { bigint: true }))
    if (!sameIdentity(finished, pathMetadata)) throw snapshotError("FILE_REPLACED")
    if (changedMetadataCode(opened, finished) !== undefined || changedMetadataCode(finished, pathMetadata) !== undefined) {
      throw snapshotError("FILE_CHANGED")
    }
    const digest = settingsChunks === undefined
      ? hash.digest("hex")
      : createHash("sha256").update(credentialBytes(Buffer.concat(settingsChunks), "settings.json")).digest("hex")
    result = { bytesRead, digest }
  } catch (error) {
    result = { bytesRead, error: errorCode(error) }
  } finally {
    if (fd !== undefined) {
      try { io.closeSync(fd) } catch (error) {
        if (result?.error === undefined) result = { bytesRead, error: errorCode(error) }
      }
    }
  }
  return result
}

function readProtectedFileStable(path, io) {
  let beforePath
  try {
    beforePath = fileMetadata(io.statSync(path, { bigint: true }))
  } catch (error) {
    if (errorCode(error) !== "ENOENT") return { error: errorCode(error) }
    let absentFd
    let result
    try {
      absentFd = io.openSync(path, "r")
      result = { error: "FILE_REPLACED" }
    } catch (openError) {
      result = errorCode(openError) === "ENOENT" ? { absent: true } : { error: errorCode(openError) }
    } finally {
      if (absentFd !== undefined) {
        try { io.closeSync(absentFd) } catch (closeError) {
          if (result?.error === undefined) result = { error: errorCode(closeError) }
        }
      }
    }
    return result
  }
  let fd
  let result
  try {
    fd = io.openSync(path, "r")
    const opened = fileMetadata(io.fstatSync(fd, { bigint: true }))
    const openingError = changedMetadataCode(beforePath, opened)
    if (openingError !== undefined) {
      const openingPath = fileMetadata(io.statSync(path, { bigint: true }))
      if (!sameIdentity(opened, openingPath)) throw snapshotError("FILE_REPLACED")
      throw snapshotError(openingError)
    }
    const content = io.readFileSync(fd)
    const finished = fileMetadata(io.fstatSync(fd, { bigint: true }))
    const afterPath = fileMetadata(io.statSync(path, { bigint: true }))
    if (!sameIdentity(finished, afterPath)) throw snapshotError("FILE_REPLACED")
    if (changedMetadataCode(opened, finished) !== undefined || changedMetadataCode(finished, afterPath) !== undefined) {
      throw snapshotError("FILE_CHANGED")
    }
    result = { content }
  } catch (error) {
    result = { error: errorCode(error) }
  } finally {
    if (fd !== undefined) {
      try { io.closeSync(fd) } catch (error) {
        if (result?.error === undefined) result = { error: errorCode(error) }
      }
    }
  }
  return result
}

function protectedFileIo(readFileOrIo) {
  if (typeof readFileOrIo === "function") {
    return { ...FILE_IO, ...Object.fromEntries(Object.entries(readFileOrIo)), readFileSync: readFileOrIo }
  }
  return { ...FILE_IO, ...readFileOrIo }
}

function fileMetadata(stat) {
  return {
    dev: BigInt(stat.dev),
    ino: BigInt(stat.ino),
    size: BigInt(stat.size),
    mtimeNs: BigInt(stat.mtimeNs),
    ctimeNs: BigInt(stat.ctimeNs),
  }
}

function sameIdentity(before, after) {
  return before.dev === after.dev && before.ino === after.ino
}

function changedMetadataCode(before, after) {
  if (!sameIdentity(before, after)) return "FILE_REPLACED"
  if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) return "FILE_CHANGED"
  return undefined
}

function boundedSize(size) {
  return size > BigInt(Number.MAX_SAFE_INTEGER) ? Number.POSITIVE_INFINITY : Number(size)
}

function snapshotError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function isTransientSnapshotEntryError(error) {
  const code = errorCode(error)
  return code === "ENOENT" || code === "ENOTDIR"
}

function compareSnapshotErrors(left, right) {
  return left.path.localeCompare(right.path) || left.code.localeCompare(right.code)
}

function collectFiles(root, files, readdir = readdirSync) {
  let entries
  try {
    entries = readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isTransientSnapshotEntryError(error)) return
    throw error
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectFiles(path, files, readdir)
    else if (entry.isFile()) files.push(path)
  }
}

function errorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN"
}
