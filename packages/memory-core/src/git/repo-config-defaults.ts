// Local config every memory repository carries. Line endings are pinned because a memory note is
// stored and checked out byte for byte: Git for Windows defaults to core.autocrlf=true, which turned
// LF into CRLF on checkout and CRLF into LF on commit (#11109).
import { readFile, rename, rm, stat, writeFile } from "../fs/resilient"
import { join } from "node:path"

import type { GitExecResult } from "./exec"

export interface RepoConfigTarget {
  readonly dir: string
  readonly agentId: string
  configGet(key: string): Promise<string | null>
  configSet(key: string, value: string): Promise<void>
}

export interface RepoGitRunner {
  result(argv: readonly string[], stdin?: string): Promise<GitExecResult>
}

export async function ensureRepoConfigDefaults(
  port: RepoConfigTarget, run: RepoGitRunner, authorName: string,
): Promise<void> {
  if ((await port.configGet("omo.agentId")) !== port.agentId) await port.configSet("omo.agentId", port.agentId)
  if (!(await port.configGet("user.email"))) await port.configSet("user.email", `${port.agentId}@omo.local`)
  if (!(await port.configGet("user.name"))) await port.configSet("user.name", authorName)
  if ((await port.configGet("commit.gpgsign")) === null) await port.configSet("commit.gpgsign", "false")
  if ((await port.configGet("gc.auto")) === null) await port.configSet("gc.auto", "0")
  // Forced, not defaulted: a memory repository is machine-owned and must keep note bytes exactly.
  // The repair never fails init(); an incomplete repair leaves the key unset so the next open retries.
  // The single guard for the whole repair: a rejected git call (spawn error, timeout, abort) counts as incomplete.
  if ((await port.configGet("core.autocrlf")) !== "false" && (await restoreConvertedCheckouts(port.dir, run).catch(() => false))) {
    await port.configSet("core.autocrlf", "false")
  }
}

// A repository opened before the pin may hold working copies a converting checkout rewrote to CRLF,
// and git's stat cache can still call them clean, so `git checkout` would skip them. A copy is
// rewritten only when dropping its CRs gives exactly the committed bytes; a real edit is never touched.
// Every step degrades instead of throwing: a path that cannot be verified (unmerged, missing blob,
// unreadable) is left as it is, and a step that could not run reports the repair incomplete.
async function restoreConvertedCheckouts(dir: string, run: RepoGitRunner): Promise<boolean> {
  const listing = await run.result(["ls-files", "--eol", "-z"])
  if (listing.code !== 0) return false
  try {
    for (const record of listing.stdout.split("\0")) {
      const tab = record.indexOf("\t")
      if (tab < 0) continue
      const [index, worktree] = record.slice(0, tab).trim().split(/\s+/)
      if (index !== "i/lf" || (worktree !== "w/crlf" && worktree !== "w/mixed")) continue
      const path = record.slice(tab + 1)
      const target = join(dir, path)
      const copy = await readFile(target).catch(() => undefined)
      const bytes = copy === undefined ? undefined : dropCarriageReturnsBeforeLineFeeds(copy)
      if (bytes === undefined || !(await matchesIndexBlob(run, path, bytes))) continue
      const { mode } = await stat(target)
      await writeFile(`${target}.omo-eol.tmp`, bytes, { mode })
      await rename(`${target}.omo-eol.tmp`, target).catch(async (error: unknown) => {
        await rm(`${target}.omo-eol.tmp`, { force: true })
        throw error
      })
    }
  } catch {
    return false
  }
  return reindexUnchangedCopies(dir, run)
}

// The index still caches each rewritten copy's CRLF size, and git calls a size change modified
// without reading the file. Re-hashing a path whose bytes equal its index blob stages that same
// blob, so it only refreshes the cache. A run that failed here is finished by the next open.
async function reindexUnchangedCopies(dir: string, run: RepoGitRunner): Promise<boolean> {
  const changed = await run.result(["diff-files", "--name-only", "-z"])
  if (changed.code !== 0) return false
  const unchanged: string[] = []
  for (const path of new Set(changed.stdout.split("\0").filter(Boolean))) {
    const copy = await readFile(join(dir, path)).catch(() => undefined)
    if (copy !== undefined && (await matchesIndexBlob(run, path, copy))) unchanged.push(path)
  }
  if (unchanged.length === 0) return true
  // Paths go on stdin: a converted Windows repository can list every note, past the command-line limit.
  const input = unchanged.map((path) => `${path}\0`).join("")
  return (await run.result(["-c", "core.autocrlf=false", "update-index", "-q", "-z", "--stdin"], input)).code === 0
}

// Byte comparison: a non-UTF-8 blob does not survive the string round trip, so it never matches.
// An unmerged path or a missing object makes cat-file fail, which counts as no match.
async function matchesIndexBlob(run: RepoGitRunner, path: string, bytes: Buffer): Promise<boolean> {
  const blob = await run.result(["cat-file", "blob", `:${path}`])
  return blob.code === 0 && Buffer.from(blob.stdout, "utf8").equals(bytes)
}

function dropCarriageReturnsBeforeLineFeeds(bytes: Buffer): Buffer {
  const out = Buffer.allocUnsafe(bytes.length)
  let length = 0
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a) continue
    out[length] = bytes[index] ?? 0
    length += 1
  }
  return out.subarray(0, length)
}
