#!/usr/bin/env bun
// PR gate (#9903): a feature PR must not change a generated output on the list; only the release-state PR may. The
// workflow runs the base branch's copy of this script and its list, so a PR cannot edit its own verdict.
import { GATE_CONFIG } from "./changelog-gate.config.ts"
import { git, isGeneratedBundlePath, loadGeneratedBundlePatterns, nulSeparated } from "./generated-bundles.ts"
import { isReleaseStatePr } from "./release-pr-marker.ts"

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

// Same identity as the changelog gate: a release branch pushed to this repository (the workflow's flag) that carries
// publish.yml's own branch, title and body marker.
function isReleaseState(env: NodeJS.ProcessEnv): boolean {
  const branch = env["GENERATED_GATE_BRANCH"] ?? ""
  return (
    env["GENERATED_GATE_RELEASE"] === "1" &&
    GATE_CONFIG.releaseBranchPattern.test(branch) &&
    isReleaseStatePr({ branch, title: env["GENERATED_GATE_TITLE"] ?? "", body: env["GENERATED_GATE_BODY"] ?? "" })
  )
}

function existsAt(cwd: string, rev: string, path: string): boolean {
  try {
    git(cwd, ["cat-file", "-e", `${rev}:${path}`])
    return true
  } catch {
    return false
  }
}

function run(): number {
  const cwd = process.cwd()
  const baseRef = process.env["GENERATED_GATE_BASE_REF"]
  const base = argument("--base") ?? (baseRef ? `origin/${baseRef}` : undefined)
  if (base === undefined) throw new Error("pass --base <rev> or set GENERATED_GATE_BASE_REF")
  if (isReleaseState(process.env)) {
    console.log("generated-bundles-gate: PASS - the release-state PR regenerates the listed outputs")
    return 0
  }
  const patterns = loadGeneratedBundlePatterns()
  const mergeBase = git(cwd, ["merge-base", base, "HEAD"]).trim()
  // --no-renames: a rename is a deletion plus an addition, so moving a listed file away still names it.
  const changed = nulSeparated(git(cwd, ["diff", "--no-renames", "--name-only", "-z", mergeBase, "HEAD"]))
  const listed = changed.filter((path) => isGeneratedBundlePath(path, patterns))
  if (listed.length === 0) {
    console.log(`generated-bundles-gate: PASS - ${changed.length} changed path(s), none generated`)
    return 0
  }
  const atBase = listed.filter((path) => existsAt(cwd, base, path))
  const notAtBase = listed.filter((path) => !atBase.includes(path))
  console.error(
    `generated-bundles-gate: FAIL - this PR changes ${listed.length} generated output(s) that only the release commit may change (#9903):`,
  )
  for (const path of listed) console.error(`  ${path}`)
  console.error(
    "Build them locally with `bun script/build-generated.ts` and leave them out of the PR. To fix this branch:",
  )
  if (atBase.length > 0) console.error(`  git checkout ${base} -- ${atBase.join(" ")}`)
  if (notAtBase.length > 0) console.error(`  git rm --cached ${notAtBase.join(" ")}`)
  console.error("then commit the result.")
  return 1
}

if (import.meta.main) process.exit(run())
