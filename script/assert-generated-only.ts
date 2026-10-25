#!/usr/bin/env bun
// The bundle-regen bot pushes to dev past the "Require passing CI on dev" ruleset (#9903), so before it
// commits, the staged diff must contain ONLY paths on the generated-bundle list. Anything else fails the
// job and nothing is pushed.
import { nonGeneratedPaths } from "./generated-bundles"

const staged = Bun.spawnSync(["git", "diff", "--cached", "--name-only", "--no-renames", "-z"])
if (staged.exitCode !== 0) {
  console.error(`assert-generated-only: git diff --cached failed: ${staged.stderr.toString()}`)
  process.exit(2)
}
const paths = staged.stdout.toString().split("\0").filter(Boolean)
const outside = nonGeneratedPaths(paths)
if (outside.length > 0) {
  console.error(`assert-generated-only: refusing to commit ${outside.length} path(s) outside script/generated-bundles.json:`)
  for (const path of outside) console.error(`  ${path}`)
  process.exit(1)
}
console.log(`assert-generated-only: ${paths.length} staged path(s), all generated bundles`)
