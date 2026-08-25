import { lstat, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { GitExec, GitExecResult } from "./exec"
import { commandError } from "./repo-arguments"
import { writeIndexIfIdentity as writeIndexConditionally } from "./path-state-index"
import {
  assertSafeParents,
  discardMovedWorktreeFile,
  errorCode,
  moveWorktreeFile,
  removeWorktreeFile,
  reserveMovedWorktreeDeletion,
  restoreClaimedWorktreeFile,
  restoreMovedWorktreeFile,
  unsupportedWorktree,
  writeWorktreeFile,
  type WorktreeDeletionReservation,
} from "./path-state-files"
const GIT_TIMEOUT_MS = 30_000
const INDEX_MODES = new Set<GitIndexMode>(["100644", "100755"])

export type GitIndexMode = "100644" | "100755"
export interface GitIndexIdentity {
  readonly mode: GitIndexMode
  readonly oid: string
}
export interface GitWorktreeFileIdentity {
  readonly kind: "file"
  readonly mode: number
  readonly oid: string
}

export type GitWorktreeIdentity = GitWorktreeFileIdentity | { readonly kind: "missing" }
export interface GitPathState {
  readonly index: GitIndexIdentity | null
  readonly worktree: GitWorktreeIdentity
}

export class GitPathStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "GitPathStateError"
  }
}
export class GitPathStateStore {
  private ownershipLossRecoveryPath: string | undefined
  constructor(
    private readonly dir: string,
    private readonly exec: GitExec,
  ) {}
  async capture(path: string): Promise<GitPathState> {
    const normalized = normalizeGitPath(path)
    return {
      index: await this.captureIndex(normalized),
      worktree: await this.captureWorktree(normalized),
    }
  }
  async captureAll(paths: readonly string[]): Promise<ReadonlyMap<string, GitPathState>> {
    const normalized = [...new Set(paths.map(normalizeGitPath))]
    const states = await Promise.all(normalized.map(async (path) => [path, await this.capture(path)] as const))
    return new Map(states)
  }
  async hashWorktreeBlob(content: string | Buffer, write = false): Promise<string> {
    return this.hashBlob([...(write ? ["-w"] : []), "--no-filters", "--stdin"], content)
  }
  async hashIndexBlob(path: string, content: string | Buffer, write = false): Promise<string> {
    const normalized = normalizeGitPath(path)
    return this.hashBlob([...(write ? ["-w"] : []), `--path=${normalized}`, "--stdin"], content)
  }
  async readBlob(oid: string): Promise<string> {
    assertOid(oid)
    return (await this.git(["cat-file", "blob", oid])).stdout
  }
  async setIndex(path: string, identity: GitIndexIdentity): Promise<void> {
    const normalized = normalizeGitPath(path)
    assertIndexIdentity(identity)
    await this.git(["update-index", "--add", "--cacheinfo", identity.mode, identity.oid, normalized])
  }
  async writeIndexIfIdentity(
    path: string,
    expected: GitIndexIdentity | null,
    next: GitIndexIdentity | null,
  ): Promise<boolean> {
    const normalized = normalizeGitPath(path)
    if (next !== null) assertIndexIdentity(next)
    return writeIndexConditionally({
      dir: this.dir,
      exec: this.exec,
      path: normalized,
      expected,
      next,
      capture: () => this.captureIndex(normalized),
    })
  }
  async removeIndex(path: string): Promise<void> {
    const normalized = normalizeGitPath(path)
    await this.git(["update-index", "--force-remove", "--", normalized])
  }
  async writeWorktree(path: string, identity: GitWorktreeFileIdentity): Promise<void> {
    const normalized = normalizeGitPath(path)
    assertWorktreeIdentity(identity)
    await writeWorktreeFile(this.dir, normalized, await this.readBlob(identity.oid), identity.mode, false)
  }
  async writeWorktreeIfIdentity(
    path: string,
    expected: GitWorktreeIdentity,
    next: GitWorktreeIdentity,
  ): Promise<boolean> {
    this.ownershipLossRecoveryPath = undefined
    const normalized = normalizeGitPath(path)
    if (expected.kind === "missing") {
      if ((await this.captureWorktree(normalized)).kind !== "missing") return false
      if (next.kind === "missing") return true
      assertWorktreeIdentity(next)
      return writeWorktreeFile(this.dir, normalized, await this.readBlob(next.oid), next.mode, true)
    }
    const moved = await moveWorktreeFile(this.dir, normalized)
    if (moved === undefined) return false
    try {
      const current = await this.captureMovedWorktree(moved)
      if (!sameIdentity(current, expected)) {
        if (!await restoreMovedWorktreeFile(this.dir, normalized, moved)) await discardMovedWorktreeFile(moved)
        return false
      }
      if (next.kind === "missing") {
        const reservation = await this.reserveWorktreeDeletion(normalized, moved)
        if (reservation === undefined) {
          await discardMovedWorktreeFile(moved)
          return false
        }
        const finalizer = await reservation.verify()
        if (finalizer === undefined) {
          await discardMovedWorktreeFile(moved)
          return false
        }
        const removed = await finalizer.finish()
        if (removed !== true) await discardMovedWorktreeFile(moved)
        if (typeof removed === "string") this.ownershipLossRecoveryPath = removed
        return removed === true
      }
      assertWorktreeIdentity(next)
      const published = await writeWorktreeFile(this.dir, normalized, await this.readBlob(next.oid), next.mode, true)
      await discardMovedWorktreeFile(moved)
      return published
    } catch (error) {
      if (!await restoreMovedWorktreeFile(this.dir, normalized, moved)) await discardMovedWorktreeFile(moved)
      throw error
    }
  }
  consumeOwnershipLossRecoveryPath(): string | undefined {
    const path = this.ownershipLossRecoveryPath
    this.ownershipLossRecoveryPath = undefined
    return path
  }
  async reserveWorktreeDeletion(
    path: string,
    moved: string,
  ): Promise<WorktreeDeletionReservation | undefined> {
    return reserveMovedWorktreeDeletion(this.dir, path, moved, (claimed) => this.restoreWorktreeClaim(path, claimed))
  }
  async restoreWorktreeClaim(path: string, claimed: string): Promise<true | string> {
    return restoreClaimedWorktreeFile(this.dir, path, claimed)
  }
  async removeWorktree(path: string): Promise<void> {
    await removeWorktreeFile(this.dir, normalizeGitPath(path))
  }
  private async captureIndex(path: string): Promise<GitIndexIdentity | null> {
    const output = (await this.git(["--literal-pathspecs", "ls-files", "--stage", "-z", "--", path])).stdout
    const records = output.split("\0").filter(Boolean)
    if (records.length === 0) return null
    const parsed = records.map(parseIndexRecord)
    if (parsed.some((record) => record.stage !== "0")) {
      throw new GitPathStateError(`Git path is unmerged and cannot be recovered safely: ${path}`)
    }
    if (parsed.length !== 1 || parsed[0]?.path !== path) {
      throw new GitPathStateError(`Git path did not resolve to one stage-zero index entry: ${path}`)
    }
    const record = parsed[0]
    if (!INDEX_MODES.has(record.mode as GitIndexMode)) {
      throw new GitPathStateError(`Unsupported Git index mode ${record.mode} for path: ${path}`)
    }
    return { mode: record.mode as GitIndexMode, oid: record.oid }
  }
  private async captureWorktree(path: string): Promise<GitWorktreeIdentity> {
    await assertSafeParents(this.dir, path)
    const fullPath = join(this.dir, path)
    let stat
    try {
      stat = await lstat(fullPath)
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { kind: "missing" }
      throw error
    }
    if (!stat.isFile()) throw unsupportedWorktree(path, stat.isSymbolicLink() ? "symlink" : "non-file")
    const oid = await this.hashWorktreeBlob(await readFile(fullPath), true)
    return { kind: "file", mode: worktreeMode(stat.mode), oid }
  }
  private async captureMovedWorktree(path: string): Promise<GitWorktreeFileIdentity> {
    const stat = await lstat(path)
    if (!stat.isFile()) throw unsupportedWorktree(path, stat.isSymbolicLink() ? "symlink" : "non-file")
    return { kind: "file", mode: worktreeMode(stat.mode), oid: await this.hashWorktreeBlob(await readFile(path), true) }
  }
  private async hashBlob(argv: readonly string[], content: string | Buffer): Promise<string> {
    const result = await this.git(["hash-object", ...argv], content)
    const oid = result.stdout.trim()
    assertOid(oid)
    return oid
  }
  private async git(argv: readonly string[], stdin?: string | Buffer): Promise<GitExecResult> {
    const result = await this.exec.run(argv, {
      cwd: this.dir,
      timeoutMs: GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      ...(stdin === undefined ? {} : { stdin }),
    })
    if (result.code !== 0) throw commandError(argv, result)
    return result
  }
}
function normalizeGitPath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const segments = normalized.split("/")
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || segments.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) {
    throw new GitPathStateError(`Invalid repository-relative Git path: ${path}`)
  }
  return normalized
}
function parseIndexRecord(record: string) {
  const match = /^(\d{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(record)
  if (match === null) throw new GitPathStateError("Git returned a malformed index entry")
  return { mode: match[1]!, oid: match[2]!, stage: match[3]!, path: match[4]! }
}
function assertOid(oid: string): void {
  if (!/^[0-9a-f]+$/.test(oid)) throw new GitPathStateError(`Invalid Git object ID: ${oid}`)
}
function assertIndexIdentity(identity: GitIndexIdentity): void {
  if (!INDEX_MODES.has(identity.mode)) throw new GitPathStateError(`Unsupported Git index mode: ${identity.mode}`)
  assertOid(identity.oid)
}
function assertWorktreeIdentity(identity: GitWorktreeFileIdentity): void {
  if (identity.kind !== "file" || !Number.isInteger(identity.mode) || identity.mode < 0 || identity.mode > 0o777) {
    throw new GitPathStateError("Invalid worktree file identity")
  }
  assertOid(identity.oid)
}
function worktreeMode(statMode: number): number {
  return process.platform === "win32" ? 0o644 : statMode & 0o777
}
function sameIdentity(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
