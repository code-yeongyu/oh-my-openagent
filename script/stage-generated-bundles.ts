#!/usr/bin/env bun
// Stages exactly the generated bundles after a regen (#9903). `git add -A` would skip a new bundle that
// packages/omo-senpi/.gitignore hides (the #9568 class), so every on-disk file the list matches is
// force-added and every listed tracked file that vanished is staged as a deletion. A build that changed
// anything else fails the job before anything is committed.
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { isGeneratedBundle, nonGeneratedPaths } from "./generated-bundles"

const ROOTS = ["packages/omo-senpi/plugin/extensions", "packages/omo-senpi/plugin/runtime", "packages/omo-senpi/plugin/scripts", "packages/omo-codex/scripts/install-dist"]

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args])
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

function filesUnder(root: string): string[] {
  const entries = (() => {
    try {
      return readdirSync(root)
    } catch {
      return []
    }
  })()
  return entries.flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

const changedOutside = nonGeneratedPaths(git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0").filter(Boolean).map((line) => line.slice(3)))
if (changedOutside.length > 0) {
  console.error(`stage-generated-bundles: the regen changed ${changedOutside.length} path(s) outside the list; refusing to commit:`)
  for (const path of changedOutside) console.error(`  ${path}`)
  process.exit(1)
}

const present = ROOTS.flatMap(filesUnder).filter(isGeneratedBundle)
const tracked = git("ls-files", "-z", "--", ...ROOTS).split("\0").filter((path) => path && isGeneratedBundle(path))
const vanished = tracked.filter((path) => !present.includes(path))

if (present.length > 0) git("add", "-f", "--", ...present)
if (vanished.length > 0) git("rm", "-q", "--cached", "--", ...vanished)
console.log(`stage-generated-bundles: ${present.length} generated file(s) staged, ${vanished.length} removed`)
