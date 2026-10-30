import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const TELEMETRY_INSTALL_ID_FILE_NAME = "install-id"

const INSTALL_ID_PATTERN = /^[0-9a-f]{64}$/
const fallbackInstallIds = new Map<string, string>()

/**
 * The distinct id of a daily-active ping: sha256 of a random 64-hex id stored once in the product's telemetry
 * state dir. The id is derived from nothing on the machine; only its hash leaves the process. Call it only on a
 * send path that has already passed every consent check, because the first call creates the file.
 */
export function getTelemetryInstallDistinctId(stateDir: string): string {
  return createHash("sha256").update(readOrCreateInstallId(join(stateDir, TELEMETRY_INSTALL_ID_FILE_NAME))).digest("hex")
}

function readOrCreateInstallId(path: string): string {
  const persisted = readInstallId(path)
  if (persisted !== undefined) return persisted

  const installId = randomBytes(32).toString("hex")
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${installId}\n`, { flag: "wx", mode: 0o600 })
    fallbackInstallIds.delete(path)
    return installId
  } catch {
    // A concurrent writer may have created it first; its id wins. A malformed file is repaired, and a read-only
    // state dir keeps one id per process.
    const concurrentlyCreated = readInstallId(path)
    if (concurrentlyCreated !== undefined) return concurrentlyCreated
    try {
      writeFileSync(path, `${installId}\n`, { flag: "w", mode: 0o600 })
      fallbackInstallIds.delete(path)
      return installId
    } catch {
      // Unwritable: fall through to the per-process id below.
    }
    const fallback = fallbackInstallIds.get(path)
    if (fallback !== undefined) return fallback
    fallbackInstallIds.set(path, installId)
    return installId
  }
}

function readInstallId(path: string): string | undefined {
  try {
    const value = readFileSync(path, "utf8").trim()
    return INSTALL_ID_PATTERN.test(value) ? value : undefined
  } catch {
    // A missing or unreadable id is minted by the caller; telemetry identity must never block the host.
    return undefined
  }
}
