import { lstat, mkdir, realpath, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"
import { acquireLock, releaseLock } from "../../../memory-core/src/locks/acquire"
import { createLockRecord } from "../../../memory-core/src/locks/lock-record"
import { GitCommandError, runGit } from "../git/command"
import type { DeltaPatchResult } from "../git/delta"
import { parseDiffGitLinePaths } from "../git/synthetic-tree"

export type MergeKind = "applied" | "already-applied" | "not-applied" | "branch-merged" | "branch-merge-failed" | "no-changes" | "retained"
export interface MergeState {
  changes_applied: boolean
  kind: MergeKind
  partial?: boolean
  nested_failed?: { path: string; error: string }[]
  branch_name?: string
  conflict?: string
  manual_command?: string
  warning?: string
}
export interface IsolationMergeResult extends MergeState {
  patch_path?: string
  nested_patch_paths?: string[]
  summary_path: string
  files_changed: number
}
export type LockHook = (event: "waiting" | "acquired" | "released", path: string) => void | Promise<void>
export interface ArtifactOptions { id: string; artifactsDir: string; lockHook?: LockHook }
export function errorText(error: unknown): string {
  return error instanceof GitCommandError ? error.stderr : error instanceof Error ? error.message : String(error)
}
export function taskBranch(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes("..") || id.endsWith(".") || id.endsWith(".lock")) throw new Error("Invalid isolation task id")
  return `omo/task/${id}`
}
export function nestedPath(root: string, relativePath: string): Promise<string> {
  return (async () => {
    const path = resolve(root, relativePath)
    if (isAbsolute(relativePath) || !path.startsWith(resolve(root) + sep)) throw new Error(`Invalid nested repository path: ${relativePath}`)
    // Lexical containment is not filesystem containment: an existing component can
    // be a symlink out of the root, redirecting every later mutation. Validate the
    // canonical location of the deepest existing ancestor of the target.
    const anchor = await deepestExistingCanonical(root)
    const existing = await deepestExistingCanonical(path)
    if (existing !== anchor && !existing.startsWith(anchor + sep)) {
      throw new Error(`Nested repository path escapes the repository root through a symlink: ${relativePath}`)
    }
    return path
  })()
}
async function deepestExistingCanonical(path: string): Promise<string> {
  let current = path
  for (;;) {
    try { return await realpath(current) } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") { current = dirname(current); continue }
      throw error
    }
  }
}

// Queue in-process callers without polling; the identity-bearing file lock also fences
// other processes and all linked worktrees sharing the same Git object/ref database.
const queues = new Map<string, Promise<void>>()
export async function withRepoLock<T>(repoRoot: string, fn: () => Promise<T>, hook?: LockHook): Promise<T> {
  const commonDir = (await runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repoRoot })).stdout.toString().trim()
  const path = join(commonDir, "omo-isolation-merge.lock")
  const previous = queues.get(path) ?? Promise.resolve()
  const turn = Promise.withResolvers<void>()
  const tail = previous.then(() => turn.promise)
  queues.set(path, tail)
  try {
    await hook?.("waiting", path)
    await previous
    const record = await createLockRecord("omo-isolation-merge")
    await acquireLock(path, record, { waitTimeoutMs: 60_000 })
    try {
      await hook?.("acquired", path)
      return await fn()
    } finally {
      await releaseLock(path, record)
      await hook?.("released", path)
    }
  } finally {
    turn.resolve()
    if (queues.get(path) === tail) queues.delete(path)
  }
}
export async function writeArtifacts(delta: DeltaPatchResult, options: ArtifactOptions) {
  taskBranch(options.id)
  const dir = resolve(options.artifactsDir, "isolation", options.id)
  await assertNoSymlinkComponents(dir, options.artifactsDir)
  await mkdir(dir, { recursive: true })
  const patch_path = join(dir, "root.patch")
  await writeFileOwned(patch_path, delta.rootPatch)
  const nested_patch_paths: string[] = []
  const nestedRoot = join(dir, "nested")
  await mkdir(nestedRoot, { recursive: true })
  for (const nested of delta.nestedPatches) {
    const path = await nestedPath(nestedRoot, `${nested.relativePath}.patch`)
    await mkdir(dirname(path), { recursive: true })
    await writeFileOwned(path, nested.patch)
    nested_patch_paths.push(path)
  }
  const files = new Set(delta.rootPatch.split("\n").flatMap(parseDiffGitLinePaths))
  for (const nested of delta.nestedPatches) {
    for (const path of nested.patch.split("\n").flatMap(parseDiffGitLinePaths)) files.add(`${nested.relativePath}/${path}`)
  }
  return { patch_path, nested_patch_paths, summary_path: join(dir, "isolation-summary.md"), files_changed: files.size }
}
/** A pre-existing symlink on the owned artifact path would redirect every write.
 * Only components at or below the caller's artifacts directory are ours to judge:
 * system-level symlinked prefixes (such as /var on macOS) are not redirects. */
async function assertNoSymlinkComponents(path: string, base: string): Promise<void> {
  const parts = resolve(path).slice(resolve(base).length).split(sep).filter(Boolean)
  let prefix = resolve(base)
  for (const part of parts) {
    prefix = join(prefix, part)
    let info
    try { info = await lstat(prefix) } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue
      throw error
    }
    if (info.isSymbolicLink()) throw new Error(`Artifact path component is a symlink: ${prefix}`)
  }
}
/** Owned outputs are created without following a pre-existing final symlink. */
async function writeFileOwned(path: string, data: string): Promise<void> {
  try { await writeFile(path, data, { flag: "wx" }) } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
    const info = await lstat(path)
    if (!info.isFile()) throw new Error(`Artifact path is not a regular file: ${path}`)
    await writeFile(path, data)
  }
}

export async function summarize(result: IsolationMergeResult): Promise<IsolationMergeResult> {
  await writeFile(result.summary_path, `# Isolation merge: ${result.kind}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`)
  return result
}
export async function stashPush(repoRoot: string): Promise<string | null> {
  if (!(await runGit(["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot })).stdout.length) return null
  const readTip = async () => (await runGit(["rev-parse", "--verify", "--quiet", "refs/stash"], { cwd: repoRoot, allowedExitCodes: [0, 1] })).stdout.toString().trim()
  const before = await readTip()
  await runGit(["stash", "push", "--include-untracked", "-m", "omo-task-merge"], { cwd: repoRoot })
  const created = await readTip()
  // A no-op push (dirt only inside a submodule, for example) leaves the stack
  // unchanged; the caller must not restore and drop an unrelated user stash.
  return created && created !== before ? created : null
}
export async function stashPop(repoRoot: string, stash: string): Promise<string | undefined> {
  // Locate OUR entry by identity: whatever sits on top when we get here belongs
  // to someone else and must survive the merge untouched.
  const list = (await runGit(["stash", "list", "--format=%H"], { cwd: repoRoot })).stdout.toString().split("\n")
  const index = list.findIndex((sha) => sha === stash)
  if (index < 0) return undefined
  const ref = `stash@{${index}}`
  const applied = await runGit(["stash", "apply", "--index", ref], { cwd: repoRoot, allowedExitCodes: [0, 1] })
  if (applied.code) return `stash restore failed; stash entry preserved: ${applied.stderr || applied.stdout.toString()}`
  const dropped = await runGit(["stash", "drop", ref], { cwd: repoRoot, allowedExitCodes: [0, 1] })
  if (dropped.code) return `stash applied but not dropped: ${dropped.stderr || dropped.stdout.toString()}`
}
