#!/usr/bin/env node
// ulw-execute worktree lifecycle (#14391): `add` creates a task-owned worktree, copies the gitignored local
// config into it and records it; `provision` re-copies into an existing one; `teardown` removes every
// recorded worktree and its branch once the branch is merged. Prints one JSON line. Exit 3: required config missing.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { provision } from "./worktree-include.mjs"

const EXIT_MISSING_REQUIRED = 3

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
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`)
  renameSync(`${path}.tmp`, path)
}

function add(repo, { path, branch, base }) {
  if (!path || !branch) throw new Error("add needs --path and --branch")
  const worktree = resolve(path)
  git(repo, ["worktree", "add", "-q", "-b", branch, worktree, ...(base ? [base] : [])])
  const manifest = readManifest(repo)
  manifest.created.push({
    path: worktree,
    branch,
    base: base ?? git(repo, ["rev-parse", "HEAD"]),
    created_at: new Date().toISOString(),
  })
  writeManifest(repo, manifest)
  return { path: worktree, branch, ...provision(repo, worktree) }
}

function isMerged(repo, branch, into) {
  return git(repo, ["branch", "--merged", into, "--format=%(refname:short)"]).split("\n").includes(branch)
}

/** Removes recorded worktrees whose branch is merged into `into` (default: the main checkout's HEAD). */
function teardown(repo, { into, force }) {
  const target = into ?? git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])
  const manifest = readManifest(repo)
  const removed = []
  const kept = []
  for (const entry of manifest.created) {
    if (!force && !isMerged(repo, entry.branch, target)) {
      kept.push({ path: entry.path, branch: entry.branch, reason: `not merged into ${target}` })
      continue
    }
    try {
      if (existsSync(entry.path)) git(repo, ["worktree", "remove", ...(force ? ["--force"] : []), entry.path])
      git(repo, ["branch", force ? "-D" : "-d", entry.branch])
      removed.push({ path: entry.path, branch: entry.branch })
    } catch (error) {
      kept.push({ path: entry.path, branch: entry.branch, reason: String(error.stderr ?? error.message).trim() })
    }
  }
  git(repo, ["worktree", "prune"])
  writeManifest(repo, { created: manifest.created.filter((entry) => kept.some((k) => k.branch === entry.branch)) })
  return { into: target, removed, kept }
}

function parseFlags(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, "")
    if (name === "force") flags.force = true
    else flags[name] = argv[++i]
  }
  return flags
}

export function main(argv) {
  const [command, ...rest] = argv
  const flags = parseFlags(rest)
  const repo = resolve(flags.repo ?? git(process.cwd(), ["rev-parse", "--show-toplevel"]))
  let result
  if (command === "add") result = add(repo, flags)
  else if (command === "provision") result = { path: resolve(flags.path), ...provision(repo, resolve(flags.path)) }
  else if (command === "teardown") result = teardown(repo, flags)
  else
    throw new Error(
      "usage: worktrees.mjs <add|provision|teardown> [--repo <dir>] [--path <dir>] [--branch <name>] [--base <ref>] [--into <branch>] [--force]",
    )
  console.log(JSON.stringify(result))
  return result.missingRequired?.length > 0 ? EXIT_MISSING_REQUIRED : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(String(error.stderr ?? error.message).trim())
    process.exitCode = 1
  }
}
