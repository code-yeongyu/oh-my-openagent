#!/usr/bin/env node
// ulw-execute worktree lifecycle (#14391): `add` creates a task-owned worktree, copies the gitignored local
// config into it and records it; `provision` re-copies into an existing one; `teardown` removes every
// recorded worktree and its branch once the branch has landed. Prints one JSON line. Exit 3: listed config is missing,
// or with no .worktreeinclude, unlisted local config (.env, .env.*) exists: ask the user before going on.
import { execFileSync, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { provision } from "./worktree-include.mjs"

const EXIT_MISSING_REQUIRED = 3
const LOCK_TIMEOUT_MS = 30_000
const LOCK_RETRY_MS = 25

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

function manifestPath(repo) {
  return join(repo, ".omo", "ulw-execute", "worktrees.json")
}

function readManifest(repo) {
  const path = manifestPath(repo)
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { created: [] }
}

function writeManifest(repo, manifest) {
  const path = manifestPath(repo)
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`)
  renameSync(tmp, path)
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}

// A lock whose recorded holder is no longer running was left by a crash: clear it instead of waiting it out.
function clearStaleLock(lock) {
  let pid
  try {
    pid = Number.parseInt(readFileSync(lock, "utf8"), 10)
  } catch {
    return
  }
  if (Number.isInteger(pid) && pid > 0 && !isAlive(pid)) rmSync(lock, { force: true })
}

// Parallel lanes run `add` at the same time: the manifest's read-edit-write holds an exclusive lock file (holding
// its owner's pid) so no entry is lost; a lost entry is a worktree teardown never removes. Keep the update short.
function withManifestLock(repo, update) {
  const lock = `${manifestPath(repo)}.lock`
  mkdirSync(dirname(lock), { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let fd
  for (;;) {
    try {
      fd = openSync(lock, "wx")
      writeFileSync(fd, `${process.pid}\n`)
      break
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      clearStaleLock(lock)
      if (Date.now() > deadline) throw new Error(`manifest lock held for over ${LOCK_TIMEOUT_MS}ms: ${lock}`)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS)
    }
  }
  try {
    const manifest = readManifest(repo)
    const result = update(manifest)
    writeManifest(repo, manifest)
    return result
  } finally {
    closeSync(fd)
    rmSync(lock, { force: true })
  }
}

function add(repo, { path, branch, base }) {
  if (!path || !branch) throw new Error("add needs --path and --branch")
  const worktree = resolve(path)
  git(repo, ["worktree", "add", "-q", "-b", branch, worktree, ...(base ? [base] : [])])
  const recordedBase = base ?? git(repo, ["rev-parse", "HEAD"])
  withManifestLock(repo, (manifest) => {
    manifest.created.push({ path: worktree, branch, base: recordedBase, created_at: new Date().toISOString() })
  })
  return { path: worktree, branch, ...provision(repo, worktree) }
}

// Landed = merged as a commit (an ancestor of `into`), or its changes are already in `into` after a squash or rebase
// merge: merging it into `into` then yields `into`'s own tree. A conflict means it has not landed.
function isLanded(repo, branch, into) {
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", branch, into], { cwd: repo, stdio: "ignore" })
  if (ancestor.status === 0) return true
  const merged = spawnSync("git", ["merge-tree", "--write-tree", into, branch], { cwd: repo, encoding: "utf8" })
  return merged.status === 0 && merged.stdout.split("\n")[0] === git(repo, ["rev-parse", `${into}^{tree}`])
}

function refExists(repo, ref) {
  return (
    spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: repo, stdio: "ignore" }).status ===
    0
  )
}

// Why an entry must stay, or undefined when its branch has landed and the worktree can go. A branch with no commit
// beyond its base has landed nothing yet: its worktree is a lane still starting, unless the folder is already gone.
function keepReason(repo, entry, target) {
  if (!refExists(repo, `refs/heads/${entry.branch}`)) return `branch ${entry.branch} no longer exists`
  const ahead = Number(git(repo, ["rev-list", "--count", `${entry.base}..refs/heads/${entry.branch}`]))
  if (ahead === 0 && existsSync(entry.path)) return "no commits beyond its base yet"
  if (ahead > 0 && !isLanded(repo, entry.branch, target)) return `not landed on ${target}`
  return undefined
}

/** Removes recorded worktrees whose branch has landed on `into` (default: the main checkout's HEAD). */
function teardown(repo, { into }) {
  const target = into ?? git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (!refExists(repo, target)) throw new Error(`--into ${target}: no such ref`)
  // Prune first: a recorded worktree whose folder is already gone still holds its branch until pruned.
  git(repo, ["worktree", "prune"])
  // The slow removals run outside the lock; only the final manifest edit holds it, so a parallel `add` never waits.
  const removed = []
  const kept = []
  for (const entry of readManifest(repo).created) {
    const reason = keepReason(repo, entry, target)
    if (reason) {
      kept.push({ path: entry.path, branch: entry.branch, reason })
      continue
    }
    try {
      if (existsSync(entry.path)) git(repo, ["worktree", "remove", entry.path])
      // -D, not -d: `-d` checks ancestry against HEAD, while landing was just verified against `target`.
      git(repo, ["branch", "-D", entry.branch])
      removed.push({ path: entry.path, branch: entry.branch })
    } catch (error) {
      kept.push({ path: entry.path, branch: entry.branch, reason: String(error.stderr ?? error.message).trim() })
    }
  }
  git(repo, ["worktree", "prune"])
  withManifestLock(repo, (manifest) => {
    manifest.created = manifest.created.filter((entry) => !removed.some((r) => r.branch === entry.branch))
  })
  return { into: target, removed, kept }
}

function parseFlags(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, "")
    flags[name] = argv[++i]
  }
  return flags
}

// The main checkout owns the local config and the manifest, wherever the CLI runs from: inside a run worktree,
// `--show-toplevel` would name that worktree instead. `git worktree list` always lists the main checkout first;
// in a bare repository that entry is the bare directory, which has no checkout to work from, so it is refused.
function mainCheckout(cwd) {
  const [first] = git(cwd, ["worktree", "list", "--porcelain"]).split("\n\n")
  const lines = first.split("\n")
  const path = lines[0].replace(/^worktree /, "")
  if (lines.includes("bare")) throw new Error(`bare repository at ${path}: run from a repository with a main checkout`)
  return path
}

export function main(argv) {
  const [command, ...rest] = argv
  const flags = parseFlags(rest)
  const repo = mainCheckout(resolve(flags.repo ?? process.cwd()))
  let result
  if (command === "add") result = add(repo, flags)
  else if (command === "provision") result = { path: resolve(flags.path), ...provision(repo, resolve(flags.path)) }
  else if (command === "teardown") result = teardown(repo, flags)
  else
    throw new Error(
      "usage: worktrees.mjs <add|provision|teardown> [--repo <dir>] [--path <dir>] [--branch <name>] [--base <ref>] [--into <branch>]",
    )
  console.log(JSON.stringify(result))
  return result.missingRequired?.length > 0 || result.unlisted?.length > 0 ? EXIT_MISSING_REQUIRED : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(String(error.stderr ?? error.message).trim())
    process.exitCode = 1
  }
}
