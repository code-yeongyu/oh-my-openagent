import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/**
 * Repository facts that cost nothing: the root comes from walking up for `.git`, and the
 * branch is read out of `HEAD`. Both are on the render path, so neither spawns a process.
 */

/** Nearest ancestor holding a `.git` entry - a directory normally, a file in a worktree. */
export function findGitRoot(cwd: string): string | undefined {
  let current = resolve(cwd)
  for (;;) {
    if (existsSync(join(current, ".git"))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Current branch, or a short sha when HEAD is detached. A worktree's `.git` is a file
 * pointing at the real git dir, so that indirection is followed once.
 */
export function readGitBranch(root: string): string | undefined {
  const gitDir = resolveGitDir(root)
  if (gitDir === undefined) return undefined
  let head: string
  try {
    head = readFileSync(join(gitDir, "HEAD"), "utf8").trim()
  } catch {
    return undefined
  }
  const ref = /^ref:\s+refs\/heads\/(.+)$/.exec(head)
  if (ref?.[1] !== undefined) return ref[1]
  return head === "" ? undefined : head.slice(0, 7)
}

function resolveGitDir(root: string): string | undefined {
  const candidate = join(root, ".git")
  if (!existsSync(candidate)) return undefined
  let contents: string
  try {
    contents = readFileSync(candidate, "utf8")
  } catch {
    // A directory read fails here, which is the ordinary case.
    return candidate
  }
  const pointer = /^gitdir:\s*(.+)$/m.exec(contents.trim())
  if (pointer?.[1] === undefined) return candidate
  const target = pointer[1].trim()
  return resolve(root, target)
}
