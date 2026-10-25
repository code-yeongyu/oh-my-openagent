import { lstatSync, readdirSync, realpathSync, rmdirSync, type Stats, unlinkSync } from "node:fs"
import { isAbsolute, join, relative } from "node:path"

import { isSpoolFileName, QUARANTINE_DIR } from "./otlp-spool-names"
import type { TelemetryDiagnosticInput, TelemetrySpoolEntryKind } from "./types"

/**
 * `refused`: the directory failed verification and nothing was deleted. `incomplete`: the sweep ran
 * but at least one regular spool file of the current user could not be deleted (see `onFailed`).
 */
export type PurgeOutcome = "purged" | "incomplete" | "absent" | "refused"

/** How the purge reports what it left behind, by kind or error code only, never by path. */
export type PurgeReport = {
  /** A spool-named entry it does not delete: not a regular file of the current user, or swapped mid-purge. */
  readonly onSkipped: (kind: TelemetrySpoolEntryKind) => void
  /** A regular spool file of the current user whose unlink failed while the entry stayed the same. */
  readonly onFailed: (code: string) => void
}

/** Test seams for what an unprivileged test cannot stage: an entry swapped mid-purge, a file of another user. */
export type PurgeSeams = {
  readonly unlink?: (path: string) => void
  readonly ownerOf?: (path: string, uid: number) => number
}

type Owner = (path: string, stat: Stats) => boolean

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

function hasCode(error: unknown, codes: readonly string[]): boolean {
  const code = errorCode(error)
  return code !== undefined && codes.includes(code)
}

/** False only where uids exist (not on Windows) and the entry belongs to someone else. */
function ownerCheck(ownerOf: PurgeSeams["ownerOf"]): Owner {
  return (path, stat) => typeof process.getuid !== "function" || (ownerOf ? ownerOf(path, stat.uid) : stat.uid) === process.getuid()
}

function realDirectory(path: string, owned: Owner): "dir" | "missing" | "other" {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink() && owned(path, stat) ? "dir" : "other"
  } catch (error) {
    if (hasCode(error, ["ENOENT"])) return "missing"
    throw error
  }
}

function isStrictlyInside(root: string, dir: string): boolean {
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch (error) {
    if (hasCode(error, ["ENOENT", "ENOTDIR"])) return false
    throw error
  }
  const rel = relative(realRoot, realpathSync(dir))
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

function lstatOrGone(path: string): Stats | "gone" {
  try {
    return lstatSync(path)
  } catch (error) {
    if (hasCode(error, ["ENOENT"])) return "gone"
    throw error
  }
}

/** The checked regular file of the current user, or why it is not deleted. */
function checkEntry(path: string, owned: Owner): Stats | TelemetrySpoolEntryKind | "gone" {
  const stat = lstatOrGone(path)
  if (stat === "gone") return "gone"
  if (stat.isSymbolicLink()) return "symlink"
  if (stat.isDirectory()) return "directory"
  if (!stat.isFile()) return "other"
  return owned(path, stat) ? stat : "foreign_owner"
}

/** After a failed unlink: did the checked file vanish, get replaced (other inode or type), or stay put? */
function afterFailedUnlink(path: string, checked: Stats): "gone" | "swapped" | "same" {
  const now = lstatOrGone(path)
  if (now === "gone") return "gone"
  return now.isFile() && now.dev === checked.dev && now.ino === checked.ino ? "same" : "swapped"
}

/** Codes an unlink of a regular file can fail with when it is denied or was swapped mid-purge. */
const DENIED_OR_SWAPPED: readonly string[] = ["EPERM", "EACCES", "EBUSY", "EISDIR", "ENOTDIR"]

type Sweep = {
  readonly owned: Owner
  readonly unlink: (path: string) => void
  readonly report: PurgeReport
  failed: number
}

function unlinkChecked(path: string, checked: Stats, sweep: Sweep): void {
  try {
    sweep.unlink(path)
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOENT") return
    if (code === undefined || !DENIED_OR_SWAPPED.includes(code)) throw error
    const state = afterFailedUnlink(path, checked)
    if (state === "swapped") sweep.report.onSkipped("other")
    if (state !== "same") return
    sweep.failed += 1
    sweep.report.onFailed(code)
  }
}

function unlinkOwned(dir: string, names: readonly string[], sweep: Sweep): void {
  for (const name of names) {
    if (!isSpoolFileName(name)) continue
    const path = join(dir, name)
    const checked = checkEntry(path, sweep.owned)
    if (checked === "gone") continue
    if (typeof checked === "string") sweep.report.onSkipped(checked)
    else unlinkChecked(path, checked, sweep)
  }
}

function removeIfEmpty(dir: string): void {
  try {
    rmdirSync(dir)
  } catch (error) {
    if (!hasCode(error, ["ENOENT", "ENOTEMPTY", "EEXIST"])) throw error
  }
}

/**
 * The opt-out purge. An opt-out is the user's decision for the product, so it covers what earlier
 * consented runs and other live processes left: sealed batches, in-flight claims, every process's
 * WAL file and the quarantine. It deletes ONLY names the spool itself creates (`isSpoolFileName`,
 * derived from the spool's own name builders), never a recursive delete, so a caller that passes a
 * shared directory loses nothing but spool files. Of those names it deletes only regular files owned
 * by the current user; a spool-named directory, symlink, special file or file of another user is
 * left in place, reported through `onSkipped` by kind (never by path), and the purge goes on.
 *
 * It runs only inside a verified spool directory: the directory (and the quarantine inside it) must
 * be a real directory owned by the current user, not a symlink or junction, and its real path must
 * lie strictly below the real path of `root`. Anything else is `refused` with no deletion.
 *
 * Race handling with other live processes of the same product:
 * - Each file is removed on its own and ENOENT is ignored, so a file another process renames or
 *   deletes in the meantime (a claim, a send that completed) is never an error.
 * - A consented process keeps an open file descriptor on its unlinked WAL file; its next seal finds
 *   the name gone and drops those records quietly (the purge already covered them), and its next
 *   append starts a new file. Its in-flight claim disappears too: the send's delete or release then
 *   finds nothing, which is also quiet.
 * - The directories are removed last and only when empty: a file a consented process created after
 *   the listing (or a foreign file) leaves the directory in place.
 * - When an unlink fails with EPERM, EACCES, EBUSY, EISDIR or ENOTDIR, the entry is checked again:
 *   gone means another process removed it (quiet); a different inode or type means it was swapped
 *   between its check and its unlink (skipped, reported as `other`); the same regular file means the
 *   deletion itself failed (immutable flag, permissions, a busy file), reported through `onFailed`
 *   with the errno code, and the outcome becomes `incomplete`. The sweep goes on in every case.
 */
export function purgeSpool(
  dir: string,
  root: string,
  report: PurgeReport,
  seams: PurgeSeams = {},
): PurgeOutcome {
  const owned = ownerCheck(seams.ownerOf)
  const kind = realDirectory(dir, owned)
  if (kind === "missing") return "absent"
  if (kind === "other" || !isStrictlyInside(root, dir)) return "refused"
  const quarantine = join(dir, QUARANTINE_DIR)
  if (realDirectory(quarantine, owned) === "other") return "refused"
  const sweep: Sweep = { owned, unlink: seams.unlink ?? unlinkSync, report, failed: 0 }
  unlinkOwned(dir, readdirSync(dir), sweep)
  try {
    unlinkOwned(quarantine, readdirSync(quarantine), sweep)
  } catch (error) {
    if (!hasCode(error, ["ENOENT"])) throw error
  }
  removeIfEmpty(quarantine)
  removeIfEmpty(dir)
  return sweep.failed > 0 ? "incomplete" : "purged"
}

/** Each entry the purge leaves behind becomes one diagnostic, by kind or errno code, never by path. */
export function purgeReport(diagnostics: ((input: TelemetryDiagnosticInput) => void) | undefined, source: string): PurgeReport {
  return {
    onSkipped: (entryKind: TelemetrySpoolEntryKind) => diagnostics?.({ event: "telemetry_spool_purge_skipped", source, entryKind }),
    onFailed: (errorCode: string) => diagnostics?.({ event: "telemetry_spool_purge_failed", source, errorCode }),
  }
}
