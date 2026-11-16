import { randomUUID } from "node:crypto"
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { EngineLaunchRefused } from "./refusal.ts"
import { sha256File } from "./trust.ts"

export interface StableSource {
  /** The located engine whose bytes were verified. */
  readonly path: string
  readonly host: string
  readonly sha256: string
  /** The per-host stable directory; the engine always runs from the same path inside it. */
  readonly directory: string
  readonly fileName: string
}

/**
 * Copies the verified engine to its fixed path under an exclusive SQLite lock (shared across
 * processes, released when its owner dies) and spawns it while the lock is held, so no other host
 * can swap the file between the last check and the exec. The staged copy is re-hashed and passes
 * `verifySignature` before it replaces the stable file; the file we run is always one we wrote.
 * `spawn` must start the process synchronously.
 */
export function launchFromStablePath<T>(
  source: StableSource,
  spawn: (path: string) => T,
  verifySignature: (path: string) => boolean,
): { readonly path: string; readonly value: T } {
  mkdirSync(source.directory, { recursive: true })
  const path = join(source.directory, source.fileName)
  const lock = new DatabaseSync(join(source.directory, "launch.lock"))
  try {
    lock.exec("PRAGMA busy_timeout = 30000")
    lock.exec("BEGIN EXCLUSIVE")
    if (!existsSync(path) || sha256File(path) !== source.sha256) install(source, path, verifySignature)
    if (sha256File(path) !== source.sha256)
      throw new EngineLaunchRefused("checksum_mismatch", source.host, `${path} changed under the lock`)
    writeFileSync(join(source.directory, "release.json"), JSON.stringify({ sha256: source.sha256 }))
    return { path, value: spawn(path) }
  } finally {
    lock.close()
  }
}

function install(source: StableSource, path: string, verifySignature: (path: string) => boolean): void {
  const staging = join(source.directory, `.engine-${randomUUID()}`)
  try {
    copyFileSync(source.path, staging)
    chmodSync(staging, 0o755)
    const staged = sha256File(staging)
    if (staged !== source.sha256) {
      throw new EngineLaunchRefused("checksum_mismatch", source.host, `${source.path} changed after it was verified`)
    }
    if (!verifySignature(staging)) {
      throw new EngineLaunchRefused(
        "designated_requirement_mismatch",
        source.host,
        `${source.path} fails the designated requirement`,
      )
    }
    renameSync(staging, path)
  } finally {
    rmSync(staging, { force: true })
  }
}
