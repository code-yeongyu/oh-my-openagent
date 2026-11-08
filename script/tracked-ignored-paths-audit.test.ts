/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const WORKSPACE_ROOT = resolve(import.meta.dir, "..")
const PREVIEW_LIMIT = 25

// Only the in-tree .gitignore files count: `--exclude-standard` would also read the developer's
// global excludes file and `.git/info/exclude`, which are per-machine and would make this audit
// pass or fail depending on who runs it.
function listTrackedIgnoredPaths(): string[] {
  const output = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--ignored", "--exclude-per-directory=.gitignore", "-z"],
    { cwd: WORKSPACE_ROOT, stdout: "pipe", stderr: "pipe" },
  )
  expect(output.exitCode).toBe(0)
  return output.stdout.toString("utf-8").split("\0").filter(Boolean).sort()
}

function describeViolations(paths: readonly string[]): string {
  if (paths.length === 0) return ""
  const preview = paths.slice(0, PREVIEW_LIMIT).map((path) => `  ${path}`)
  const remainder = paths.length > PREVIEW_LIMIT ? [`  ... and ${paths.length - PREVIEW_LIMIT} more`] : []
  return [
    `${paths.length} tracked file(s) match a .gitignore rule. Either stop tracking them (git rm --cached)`,
    "or add an explicit `!` negation to .gitignore for the paths that are meant to be committed:",
    ...preview,
    ...remainder,
  ].join("\n")
}

describe("tracked ignored paths audit", () => {
  test("#given the committed tree #when compared with the in-tree .gitignore rules #then no tracked file matches an ignore rule", () => {
    // given
    const trackedIgnored = listTrackedIgnoredPaths()

    // when
    const violations = describeViolations(trackedIgnored)

    // then
    expect(violations).toBe("")
  })
})
