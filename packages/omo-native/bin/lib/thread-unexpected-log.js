import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  writeSync,
} from "node:fs"
import { join } from "node:path"
import { inspect } from "node:util"

/** At this size the log is moved to `<file>.1` (replacing an older one) and a new file starts: at most twice this on disk. */
export const UNEXPECTED_LOG_MAX_BYTES = 1024 * 1024

/** One record is cut to this many bytes, so a file never passes the bound and the two files never pass twice it. */
export const UNEXPECTED_RECORD_MAX_BYTES = 64 * 1024

const OWNER_ONLY = 0o077

/**
 * `omo thread`'s sink for an unexpected exception (B8, the security owner's ruling): an owner-only local file under the
 * agent directory, never a stream. The returned port writes the exception's whole text (message, stack, causes,
 * properties) and answers the file's real path, which the fixed message then names; any failure writes nothing and
 * answers nothing, so it changes no answer and no exit.
 */
export function agentDirUnexpectedLog(agentDir, uid = process.getuid?.()) {
  const directory = join(agentDir, "logs")
  const file = join(directory, "thread-unexpected.log")
  return (error) => {
    try {
      if (!ownerOnlyDirectory(directory, uid)) return undefined
      const descriptor = openOwnerOnly(file, uid)
      if (descriptor === undefined) return undefined
      try {
        writeSync(descriptor, record(error))
      } finally {
        closeSync(descriptor)
      }
      return join(realpathSync(directory), "thread-unexpected.log")
    } catch {
      return undefined
    }
  }
}

function ownerOnlyDirectory(directory, uid) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = lstatSync(directory)
  return stat.isDirectory() && !stat.isSymbolicLink() && owned(stat, uid) && (stat.mode & OWNER_ONLY) === 0
}

function openOwnerOnly(file, uid) {
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0)
  const descriptor = openSync(file, flags, 0o600)
  const stat = fstatSync(descriptor)
  // Ownership first: a file someone else made, or one readable by others, is neither appended to nor rotated.
  if (!ownerOnlyFile(stat, uid)) {
    closeSync(descriptor)
    return undefined
  }
  if (stat.size + UNEXPECTED_RECORD_MAX_BYTES <= UNEXPECTED_LOG_MAX_BYTES) return descriptor
  closeSync(descriptor)
  renameSync(file, `${file}.1`)
  const fresh = openSync(file, flags | constants.O_EXCL, 0o600)
  if (ownerOnlyFile(fstatSync(fresh), uid)) return fresh
  closeSync(fresh)
  return undefined
}

const ownerOnlyFile = (stat, uid) => stat.isFile() && owned(stat, uid) && (stat.mode & OWNER_ONLY) === 0

const owned = (stat, uid) => uid === undefined || stat.uid === uid

function record(error) {
  const text = Buffer.from(`${new Date().toISOString()} ${inspect(error, { depth: 6, showHidden: true })}`)
  const kept =
    text.length < UNEXPECTED_RECORD_MAX_BYTES
      ? text
      : Buffer.concat([text.subarray(0, UNEXPECTED_RECORD_MAX_BYTES - 32), Buffer.from(" [record cut at its bound]")])
  return Buffer.concat([kept, Buffer.from("\n")])
}
