#!/usr/bin/env bun
// Tree invariant after `bun script/build-generated.ts` (#13192): the build modifies no tracked file and every path it
// writes is ignored, so `git status` is empty. A modified tracked file is a derived file whose committed copy is stale
// (the daemon launch spec); an untracked file is a new output nobody listed and ignored.
import { git, nulSeparated } from "./generated-bundles.ts"

// `git status --porcelain=v1 -z`: "XY path", and a rename or copy carries its source as the next entry.
function statusEntries(output: string): { readonly status: string; readonly path: string }[] {
  const fields = nulSeparated(output)
  const entries: { status: string; path: string }[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? ""
    const status = field.slice(0, 2)
    entries.push({ status, path: field.slice(3) })
    if (status.includes("R") || status.includes("C")) index += 1
  }
  return entries
}

function run(): number {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim()
  const problems = statusEntries(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]))
  if (problems.length === 0) {
    console.log("check-generated-tree: PASS - the build changed no tracked file and wrote only ignored paths")
    return 0
  }
  console.error("check-generated-tree: FAIL - the build left the tree dirty:")
  for (const { status, path } of problems) console.error(`  ${status} ${path}`)
  console.error(
    "A modified tracked file is stale: run its generator and commit the result. An untracked file is an output nobody listed: add it to script/generated-bundles.json and the ignore rules.",
  )
  return 1
}

if (import.meta.main) process.exit(run())
