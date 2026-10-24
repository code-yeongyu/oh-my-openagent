#!/usr/bin/env bun
import { checkGeneratedBundles } from "./generated-bundles"

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args])
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

function run(): number {
  const base = process.env.GENERATED_BUNDLES_BASE
  const head = process.env.GENERATED_BUNDLES_HEAD ?? "HEAD"
  if (!base) throw new Error("missing GENERATED_BUNDLES_BASE")
  const mergeBase = git("merge-base", base, head).trim()
  const changedFiles = git("diff", "--name-only", "--no-renames", "-z", mergeBase, head).split("\0").filter(Boolean)
  const result = checkGeneratedBundles(
    {
      changedFiles,
      branch: process.env.GENERATED_BUNDLES_BRANCH ?? "",
      author: process.env.GENERATED_BUNDLES_AUTHOR ?? "",
    },
    { releaseBranchPattern: /^release\//, releaseActors: ["sisyphus-dev-ai"] },
  )
  console.log(`generated-bundles: ${result.pass ? "PASS" : "FAIL"} - ${result.reason}`)
  return result.pass ? 0 : 1
}

if (import.meta.main) {
  try {
    process.exitCode = run()
  } catch (error) {
    console.error(`generated-bundles: ERROR - ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
