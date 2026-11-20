import { spawnSync } from "node:child_process"
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs"
import { dirname, isAbsolute, join, relative, sep } from "node:path"

// Gitignored local config a fresh `git worktree add` leaves behind (#14391). Only what `.worktreeinclude` lists is
// ever copied. Without that file nothing is copied, and the root `.env` / `.env.*` files that exist are reported
// as `unlisted` so the run stops and asks instead of working without them. A plain listed path is required:
// missing, it stops the run. A copy needs a path both trees ignore and keeps the source file's mode.
const ENV_CANDIDATES = /^\.env(?:\..+)?$/
const INCLUDE_FILE = ".worktreeinclude"

/** @returns {{ patterns: string[], explicit: boolean }} */
function readIncludeList(repo) {
  const file = join(repo, INCLUDE_FILE)
  if (!existsSync(file)) return { patterns: [], explicit: false }
  const patterns = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
  return { patterns, explicit: true }
}

function isGlob(pattern) {
  return /[*?]/.test(pattern)
}

function globToRegExp(segment) {
  const escaped = segment
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
  return new RegExp(`^${escaped}$`)
}

function escapes(repo, pattern) {
  if (isAbsolute(pattern)) return true
  const rel = relative(repo, join(repo, pattern))
  return rel === "" || rel.startsWith("..") || isAbsolute(rel)
}

/** Expands one pattern to repo-relative paths; a glob may sit in the last segment only. */
function expand(repo, pattern) {
  if (!isGlob(pattern)) return [pattern]
  const dir = dirname(pattern)
  if (isGlob(dir)) return []
  const base = dir === "." ? repo : join(repo, dir)
  if (!existsSync(base)) return []
  const matcher = globToRegExp(pattern.slice(dir === "." ? 0 : dir.length + 1))
  return readdirSync(base)
    .filter((name) => matcher.test(name))
    .map((name) => (dir === "." ? name : join(dir, name)))
}

/**
 * Copies the include list from the main checkout into a worktree. A symlink, a path outside the repo, or a
 * directory is refused; a file already in the worktree is never overwritten.
 */
export function provision(repo, worktree) {
  const { patterns, explicit } = readIncludeList(repo)
  const result = { provisioned: [], skipped: [], refused: [], missingRequired: [], unlisted: [] }
  if (!explicit) {
    result.unlisted = readdirSync(repo).filter((name) => ENV_CANDIDATES.test(name) && isGitIgnored(repo, name))
  }
  for (const pattern of patterns) {
    if (escapes(repo, pattern)) {
      result.refused.push(pattern)
      continue
    }
    const paths = expand(repo, pattern)
    if (
      paths.length === 0 ||
      (!isGlob(pattern) && !existsSync(join(repo, pattern)) && !isSymlink(join(repo, pattern)))
    ) {
      if (explicit && !isGlob(pattern)) result.missingRequired.push(pattern)
      continue
    }
    for (const path of paths) copyOne(repo, worktree, path, result)
  }
  return result
}

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

// Only a file git ignores may be copied, and it must be ignored by the WORKTREE's own rules too (its .gitignore
// comes from the base, not from the checkout's working tree): anything else shows up as untracked there and can be
// staged and committed with the run's work, which for a secret means publishing it.
function isGitIgnored(cwd, path) {
  return spawnSync("git", ["check-ignore", "-q", "--", path], { cwd, stdio: "ignore" }).status === 0
}

function within(root, path) {
  const rel = relative(realpathSync(root), path)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

// The nearest existing ancestor of a path, resolved through symlinks: a symlinked directory on the way
// (in the repo or in the worktree) must not carry the copy outside its tree.
function resolvedAncestor(path) {
  let current = path
  while (!existsSync(current)) current = dirname(current)
  return realpathSync(current)
}

function copyOne(repo, worktree, path, result) {
  const source = join(repo, path)
  const stat = lstatSync(source)
  const target = join(worktree, path)
  // Checked before any realpath: a dangling symlink would make realpathSync throw.
  if (stat.isSymbolicLink() || !stat.isFile()) {
    result.refused.push(path)
    return
  }
  if (
    !within(repo, realpathSync(source)) ||
    !within(worktree, join(resolvedAncestor(dirname(target)), "x")) ||
    !isGitIgnored(repo, path) ||
    !isGitIgnored(worktree, path)
  ) {
    result.refused.push(path)
    return
  }
  // lstat, not existsSync: a dangling symlink at the target reads as absent and copyFileSync would follow it.
  if (existsSync(target) || isSymlink(target)) {
    result.skipped.push(path)
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target, constants.COPYFILE_EXCL)
  result.provisioned.push(path.split(sep).join("/"))
}
