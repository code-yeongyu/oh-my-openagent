import { createHash } from "node:crypto"
import { closeSync, fstatSync, openSync, opendirSync, readFileSync, readSync, statSync } from "node:fs"

const HASH_CHUNK_BYTES = 64 * 1024

export const FILE_IO = { closeSync, fstatSync, openSync, opendirSync, readFileSync, readSync, statSync }

export function hashFileBounded(file, remainingBytes, io, normalizeCredential) {
  let fd
  let bytesRead = 0
  let result
  try {
    fd = io.openSync(file.path, "r")
    const opened = fileMetadata(io.fstatSync(fd, { bigint: true }))
    const openingError = changedMetadataCode(file.metadata, opened)
    if (openingError !== undefined) diagnoseOpeningRace(file.path, opened, openingError, io)
    const hash = createHash("sha256")
    const settingsChunks = file.rel === "settings.json" ? [] : undefined
    const buffer = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, Math.max(file.size, 1)))
    while (bytesRead < file.size) {
      const requested = Math.min(buffer.length, file.size - bytesRead, remainingBytes - bytesRead)
      let count
      try {
        count = io.readSync(fd, buffer, 0, requested, bytesRead)
      } catch (readError) {
        let shrank = false
        try {
          shrank = fileMetadata(io.fstatSync(fd, { bigint: true })).size < file.metadata.size
        } catch {
          // The diagnostic cannot replace the primary read error.
        }
        if (shrank) throw snapshotError("SHORT_READ")
        throw readError
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
      : createHash("sha256").update(normalizeCredential(Buffer.concat(settingsChunks), "settings.json")).digest("hex")
    result = { bytesRead, digest }
  } catch (error) {
    result = { bytesRead, error: errorCode(error) }
  } finally {
    if (fd !== undefined) {
      try {
        io.closeSync(fd)
      } catch (error) {
        if (result?.error === undefined) result = { bytesRead, error: errorCode(error) }
      }
    }
  }
  return result
}

export function readProtectedFileStable(path, io) {
  let beforePath
  try {
    beforePath = fileMetadata(io.statSync(path, { bigint: true }))
  } catch (error) {
    if (errorCode(error) !== "ENOENT") return { error: errorCode(error) }
    return readProtectedAbsentRace(path, io)
  }
  let fd
  let result
  try {
    fd = io.openSync(path, "r")
    const opened = fileMetadata(io.fstatSync(fd, { bigint: true }))
    const openingError = changedMetadataCode(beforePath, opened)
    if (openingError !== undefined) diagnoseOpeningRace(path, opened, openingError, io)
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
      try {
        io.closeSync(fd)
      } catch (error) {
        if (result?.error === undefined) result = { error: errorCode(error) }
      }
    }
  }
  return result
}

export function errorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN"
}

export function isTransientSnapshotEntryError(error) {
  const code = errorCode(error)
  return code === "ENOENT" || code === "ENOTDIR"
}

export function fileMetadata(stat) {
  return {
    dev: BigInt(stat.dev),
    ino: BigInt(stat.ino),
    size: BigInt(stat.size),
    mtimeNs: BigInt(stat.mtimeNs),
    ctimeNs: BigInt(stat.ctimeNs),
  }
}

function readProtectedAbsentRace(path, io) {
  let fd
  let result
  try {
    fd = io.openSync(path, "r")
    result = { error: "FILE_REPLACED" }
  } catch (error) {
    result = errorCode(error) === "ENOENT" ? { absent: true } : { error: errorCode(error) }
  } finally {
    if (fd !== undefined) {
      try {
        io.closeSync(fd)
      } catch (error) {
        if (result?.error === undefined) result = { error: errorCode(error) }
      }
    }
  }
  return result
}

function diagnoseOpeningRace(path, opened, openingError, io) {
  let currentPath
  try {
    currentPath = fileMetadata(io.statSync(path, { bigint: true }))
  } catch {
    throw snapshotError(openingError)
  }
  if (!sameIdentity(opened, currentPath)) throw snapshotError("FILE_REPLACED")
  throw snapshotError(openingError)
}

function sameIdentity(before, after) {
  return before.dev === after.dev && before.ino === after.ino
}

function changedMetadataCode(before, after) {
  if (!sameIdentity(before, after)) return "FILE_REPLACED"
  if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) return "FILE_CHANGED"
  return undefined
}

function snapshotError(code) {
  return Object.assign(new Error(code), { code })
}
