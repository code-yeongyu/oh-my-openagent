#!/usr/bin/env bun
// Tree invariant after `bun script/build-generated.ts` (#9903). Mode `pr`: a listed output may differ from the commit,
// because feature PRs never commit them; any other modified or untracked path fails, since it is either a stale
// PR-committed generated file or an output nobody listed. Mode `release` (the release-state PR): nothing may differ,
// byte for byte, so the committed outputs equal the rebuild.
import { git, isGeneratedBundlePath, loadGeneratedBundlePatterns, nulSeparated } from "./generated-bundles.ts"

const MODES = ["pr", "release"] as const
type TreeMode = (typeof MODES)[number]

function parseMode(): TreeMode | undefined {
  const at = process.argv.indexOf("--mode")
  const value = at === -1 ? undefined : process.argv[at + 1]
  return MODES.find((mode) => mode === value)
}

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
  const mode = parseMode()
  if (mode === undefined) {
    console.error("usage: bun script/check-generated-tree.ts --mode pr|release")
    return 2
  }
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim()
  const patterns = loadGeneratedBundlePatterns()
  const entries = statusEntries(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]))
  const problems = mode === "release" ? entries : entries.filter(({ path }) => !isGeneratedBundlePath(path, patterns))
  if (problems.length === 0) {
    console.log(`check-generated-tree: PASS (${mode}) - ${entries.length} listed output(s) differ from the commit`)
    return 0
  }
  console.error(
    mode === "release"
      ? "check-generated-tree: FAIL (release) - the committed outputs differ from the rebuild:"
      : "check-generated-tree: FAIL (pr) - the build changed paths that are not on script/generated-bundles.json:",
  )
  for (const { status, path } of problems) console.error(`  ${status} ${path}`)
  if (mode === "pr")
    console.error(
      "A modified tracked file is a stale PR-committed generated file: run its generator and commit the result. An untracked file is a new output: add it to the list.",
    )
  return 1
}

if (import.meta.main) process.exit(run())
