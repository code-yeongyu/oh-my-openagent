/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const WORKSPACE_ROOT = resolve(import.meta.dir, "..")
const PREVIEW_LIMIT = 25

// QA evidence is written locally and summarized in the PR body; it is never committed (#8703).
// This audit reads the index directly rather than .gitignore, so a later `!` negation or a
// `git add -f` cannot reintroduce evidence without turning this test red.
const EVIDENCE_ROOT_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: ".omo/evidence/", pattern: /^\.omo\/evidence\// },
  { label: "packages/*/.omo/evidence/", pattern: /^packages\/[^/]+\/\.omo\/evidence\// },
  { label: ".qa-evidence/ (any depth)", pattern: /(^|\/)\.qa-evidence\// },
  { label: "qa-evidence/ (any depth)", pattern: /(^|\/)qa-evidence\// },
]

function listTrackedPaths(): string[] {
  const output = Bun.spawnSync(["git", "ls-files", "--cached", "-z"], {
    cwd: WORKSPACE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(output.exitCode).toBe(0)
  return output.stdout.toString("utf-8").split("\0").filter(Boolean)
}

export function findTrackedEvidencePaths(paths: readonly string[]): string[] {
  return paths.filter((path) => EVIDENCE_ROOT_PATTERNS.some((root) => root.pattern.test(path))).sort()
}

function describeViolations(paths: readonly string[]): string {
  if (paths.length === 0) return ""
  const preview = paths.slice(0, PREVIEW_LIMIT).map((path) => `  ${path}`)
  const remainder = paths.length > PREVIEW_LIMIT ? [`  ... and ${paths.length - PREVIEW_LIMIT} more`] : []
  const roots = EVIDENCE_ROOT_PATTERNS.map((root) => root.label).join(", ")
  return [
    `${paths.length} tracked file(s) live under a QA evidence root (${roots}).`,
    "Evidence stays local: keep it under .omo/evidence/<slug>/ (gitignored), summarize it in the PR body,",
    "and remove these from the index with `git rm -r --cached <path>`:",
    ...preview,
    ...remainder,
  ].join("\n")
}

describe("tracked evidence paths audit", () => {
  test("#given the committed tree #when scanned for QA evidence roots #then no tracked file lives under one", () => {
    // given
    const tracked = listTrackedPaths()

    // when
    const violations = describeViolations(findTrackedEvidencePaths(tracked))

    // then
    expect(violations).toBe("")
  })

  test("#given paths inside and outside the evidence roots #when filtered #then only evidence paths are reported", () => {
    // given
    const paths = [
      ".omo/evidence/20260922-run/red.txt",
      "packages/omo-senpi/.omo/evidence/x.txt",
      ".qa-evidence/omo-row-RED.txt",
      "packages/senpi-task/.qa-evidence/GREEN.txt",
      "local-ignore/qa-evidence/20260819-senpi/log.txt",
      ".omo/rules/test-discipline.md",
      ".omo/fixtures/releases.json",
      "packages/omo-codex/plugin/components/lazycodex-executor-verify/test/codex-hook.test.ts",
      "script/qa/web-terminal-visual-qa.mjs",
    ]

    // when
    const reported = findTrackedEvidencePaths(paths)

    // then
    expect(reported).toEqual([
      ".omo/evidence/20260922-run/red.txt",
      ".qa-evidence/omo-row-RED.txt",
      "local-ignore/qa-evidence/20260819-senpi/log.txt",
      "packages/omo-senpi/.omo/evidence/x.txt",
      "packages/senpi-task/.qa-evidence/GREEN.txt",
    ])
  })
})
