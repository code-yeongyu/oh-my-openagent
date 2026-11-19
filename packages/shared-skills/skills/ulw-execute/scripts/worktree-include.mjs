import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, sep } from "node:path"

// Gitignored local config a fresh `git worktree add` leaves behind (#14391). Without an include file the
// root `.env` and `.env.*` files are copied; `.worktreeinclude` replaces that default with its own list,
// and an empty one copies nothing. A plain listed path is required: missing, it stops the run.
const DEFAULT_PATTERNS = [".env", ".env.*"]
const INCLUDE_FILE = ".worktreeinclude"

/** @returns {{ patterns: string[], explicit: boolean }} */
export function readIncludeList(repo) {
  const file = join(repo, INCLUDE_FILE)
  if (!existsSync(file)) return { patterns: DEFAULT_PATTERNS, explicit: false }
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
  const result = { provisioned: [], skipped: [], refused: [], missingRequired: [] }
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

function copyOne(repo, worktree, path, result) {
  const source = join(repo, path)
  const stat = lstatSync(source)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    result.refused.push(path)
    return
  }
  const target = join(worktree, path)
  if (existsSync(target)) {
    result.skipped.push(path)
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  result.provisioned.push(path.split(sep).join("/"))
}
