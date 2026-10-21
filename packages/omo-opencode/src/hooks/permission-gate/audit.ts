import { appendFileSync, mkdirSync } from "node:fs"
import { chmodSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { PermissionGateDecision } from "./schema"

/**
 * Permission-gate audit log.
 *
 * One entry per `decision` worth keeping, in JSONL form. Path:
 *
 *     $HOME/.omo/audit/<YYYY-MM-DD>/<sessionID>.jsonl
 *
 * The directory and the audit file are created with mode 600 (best-effort on
 * systems that support chmod). Each `appendFileSync` writes one line, the
 * directory is created lazily on first write for the day.
 *
 * Failures are swallowed and surfaced via stderr; the gate never bubbles an
 * audit-write error up to the tool call itself (that would be the worst kind
 * of "audit failure blocks the user" footgun).
 */

export type PermissionAuditEntry = {
  ts: string
  tool: string
  targetPath: string | undefined
  sessionID: string
  decision: PermissionGateDecision["value"]
  source: PermissionGateDecision["source"]
}

let _auditHomeOverride: string | undefined

export function setPermissionGateAuditHomedirOverride(homedirLike: string): void {
  _auditHomeOverride = homedirLike
}

export function clearPermissionGateAuditHomedirOverride(): void {
  _auditHomeOverride = undefined
}

function resolveAuditHome(): string {
  return _auditHomeOverride ?? homedir()
}

function formatDate(now: Date = new Date()): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  const day = String(now.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function ensureMode(target: string, mode: number): void {
  try {
    chmodSync(target, mode)
  } catch {
    // chmod is a best-effort on POSIX; on Windows / odd filesystems
    // silently ignore. Tests assert mode on POSIX-only paths.
  }
}

/**
 * Append one entry. Returns the resolved audit path so a test can pin it.
 * Never throws.
 */
export function writeAuditEntry(decision: PermissionGateDecision): string | undefined {
  const entry: PermissionAuditEntry = {
    ts: new Date().toISOString(),
    tool: decision.tool,
    targetPath: decision.targetPath,
    sessionID: decision.sessionID,
    decision: decision.value,
    source: decision.source,
  }

  const root = resolveAuditHome()
  const dir = join(root, ".omo", "audit", formatDate())
  const filePath = join(dir, `${decision.sessionID}.jsonl`)

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    appendFileSync(filePath, JSON.stringify(entry) + "\n", { encoding: "utf-8", mode: 0o600 })
    ensureMode(filePath, 0o600)
  } catch (error) {
    try {
      process.stderr.write(
        `[permission-gate] failed to write audit entry: ${(error as Error).message}\n`,
      )
    } catch {
      // give up silently
    }
    return undefined
  }

  return filePath
}
