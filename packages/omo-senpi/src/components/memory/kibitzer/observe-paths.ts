// Where one main session's sidecar lives on disk and which lock owns it. The directory name is the
// unpadded URL-safe base64 of the parent session id's UTF-8 bytes: injective (two ids never share a
// directory), decodable, and a safe path segment for any id.

import { join } from "node:path"

export const KIBITZER_WAKES_FILENAME = "wakes.ndjson"
export const OWNER_LOCK_PURPOSE = "recall-sidecar"
export const PRUNE_TOMBSTONE_PREFIX = ".prune-"
export const ENCODED_SESSION_PATTERN = /^[A-Za-z0-9_-]+$/
const SIDECARS_DIRNAME = "sidecars"
const OWNER_LOCK_PREFIX = "recall-sidecar."
const OWNER_LOCK_SUFFIX = ".lock"

/** Unpadded URL-safe base64 of the id's UTF-8 bytes: injective, and every output is a safe path segment. */
export function encodeKibitzerSessionId(sessionId: string): string {
  return Buffer.from(sessionId, "utf8").toString("base64url")
}

/** The exact parent session id behind a sidecar directory name, or undefined for a name this module never produced. */
export function decodeKibitzerSidecarDirName(name: string): string | undefined {
  if (!ENCODED_SESSION_PATTERN.test(name)) return undefined
  const bytes = Buffer.from(name, "base64url")
  return bytes.toString("base64url") === name ? bytes.toString("utf8") : undefined
}

export function kibitzerSidecarsRoot(recallDir: string): string {
  return join(recallDir, SIDECARS_DIRNAME)
}

/**
 * `recall/sidecars/<encoded-session>/`: URL-safe base64 of the parent session id's UTF-8 bytes,
 * unpadded, so distinct ids never share a directory and any id is a safe path segment.
 */
export function kibitzerSidecarSessionDir(recallDir: string, sessionId: string): string {
  return join(kibitzerSidecarsRoot(recallDir), encodeKibitzerSessionId(sessionId))
}

export function kibitzerWakesFile(recallDir: string, sessionId: string): string {
  return join(kibitzerSidecarSessionDir(recallDir, sessionId), KIBITZER_WAKES_FILENAME)
}

/** The lock a live session holds over its sidecar directory, under the identity's `runtime/locks`. */
export function kibitzerSidecarOwnerLockPath(locksDir: string, sessionId: string): string {
  return ownerLockPathFor(locksDir, encodeKibitzerSessionId(sessionId))
}

export function ownerLockPathFor(locksDir: string, encodedSession: string): string {
  return join(locksDir, `${OWNER_LOCK_PREFIX}${encodedSession}${OWNER_LOCK_SUFFIX}`)
}
