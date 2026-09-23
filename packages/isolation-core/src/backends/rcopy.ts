import { chmod, copyFile, cp, lstat, mkdir, readFile, readlink, rm, symlink, utimes } from "node:fs/promises"
import { dirname, join } from "node:path"
import { IsolationUnavailableError, type IsolationBackend, type IsolationContext } from "../backend"
import { exists, git, gitResult } from "../git/command"
import { markStarted } from "../backend-marker"
import { copyBudget, copyTree } from "./copy-tree"

export async function seedDirtyState(lower: string, merged: string, consume: (size: number) => void = () => {}): Promise<void> {
  const staged = await git(lower, ["diff", "--binary", "--no-color", "--no-ext-diff", "--cached"])
  if (staged.length) await git(merged, ["apply", "--index", "--binary", "-"], staged)
  const unstaged = await git(lower, ["diff", "--binary", "--no-color", "--no-ext-diff"])
  if (unstaged.length) await git(merged, ["apply", "--binary", "-"], unstaged)
  const untracked = await git(lower, ["ls-files", "--others", "--exclude-standard", "-z"])
  for (const entry of untracked.toString().split("\0").filter(Boolean)) {
    // Git reports an embedded repository as a single directory entry and does not
    // descend into it; strip its trailing separator and seed the whole tree.
    const name = entry.endsWith("/") ? entry.slice(0, -1) : entry
    const src = join(lower, name), dst = join(merged, name)
    const info = await lstat(src)
    await mkdir(dirname(dst), { recursive: true })
    if (info.isSymbolicLink()) await symlink(await readlink(src), dst)
    else if (info.isDirectory()) {
      // An embedded repository: copy worktree and Git metadata so the isolated
      // tree is complete; the detached-metadata pass privatizes its administration.
      await cp(src, dst, {
        recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false, preserveTimestamps: true,
        filter: async (source) => {
          const detail = await lstat(source)
          if (detail.isFile()) consume(detail.size)
          return detail.isFile() || detail.isDirectory() || detail.isSymbolicLink()
        },
      })
    }
    else if (info.isFile()) {
      consume(info.size)
      await copyFile(src, dst)
      await chmod(dst, info.mode)
      await utimes(dst, info.atime, info.mtime)
    }
    // Sockets, FIFOs and devices are process-local, not copyable state.
  }
}

export class RcopyBackend implements IsolationBackend {
  readonly kind = "rcopy" as const
  readonly clonesTree = false
  async probe(_repoRoot: string) { return { available: true } }

  async start(lower: string, merged: string, ctx: IsolationContext): Promise<void> {
    if (await exists(merged)) throw new Error(`rcopy destination already exists: ${merged}`)
    await mkdir(dirname(merged), { recursive: true })
    if (await exists(join(lower, ".git"))) {
      // Missing git is unavailable, not permission to copy shared git metadata blindly.
      await git(lower, ["worktree", "add", "--detach", merged, "HEAD"])
      await seedDirtyState(lower, merged, await copyBudget(ctx.baseDir, ctx.maxCopyBytes))
      await markStarted(ctx.baseDir, this.kind)
      return
    }
    const consume = await copyBudget(ctx.baseDir, ctx.maxCopyBytes)
    // Copy through the shared walker: it counts during the traversal (no
    // prewalk), skips sockets/FIFOs like the old fs.cp filter, and never
    // descends into its own destination when a pathological layout places it
    // inside the source.
    await copyTree(lower, merged, async (source, destination) => { await copyFile(source, destination) }, consume)
    await markStarted(ctx.baseDir, this.kind)
  }

  async stop(merged: string): Promise<void> {
    const entry = join(merged, ".git")
    if (await exists(entry) && (await lstat(entry)).isFile()) {
      // Resolve registration through the worktree itself, including after process restart.
      let admin: string | undefined
      try { admin = (await readFile(entry, "utf8")).trim().replace(/^gitdir: /, "") } catch { /* fall through */ }
      try {
        const result = await gitResult(merged, ["worktree", "remove", "--force", merged])
        if (result.code) {
          // Only an actually-gone registration makes removal failure spurious;
          // a live one must surface instead of leaking a stale registration.
          if (admin && await exists(admin)) throw new Error(`git worktree remove failed (${result.code}): ${result.stderr}`)
        }
      } catch (error) {
        // Teardown remains possible if git disappeared after creation.
        if (!(error instanceof IsolationUnavailableError)) throw error
      }
    }
    await rm(merged, { recursive: true, force: true })
  }
}
