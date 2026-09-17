import { execSync } from "node:child_process"
import { describe, expect, test } from "bun:test"

/**
 * Audit: no tracked file should match an ignore rule.
 *
 * Sanctioned paths (evidence, fixtures, plugin skills, eval outputs) are
 * explicitly un-ignored via `!` negations in .gitignore, so they must NOT
 * appear in this list. If a new stray artifact gets force-added past the
 * ignore rules, this test fails.
 *
 * See #8406 for the initial cleanup.
 */
describe("tracked-ignored-paths audit", () => {
  test("no tracked file matches an ignore rule (excluding .omo/evidence)", () => {
    const output = execSync(
      "git ls-files --cached --ignored --exclude-standard",
      { cwd: process.cwd(), encoding: "utf-8" },
    ).trim()

    const tracked = output
      .split("\n")
      .filter(Boolean)
      // .omo/evidence/** is mandated by AGENTS.md and un-ignored via `!`
      // negation, but `git ls-files --cached --ignored` still reports
      // already-tracked files under it. Filter them out.
      .filter((p) => !p.startsWith(".omo/evidence/"))

    // Sanctioned paths that are explicitly un-ignored but may still appear
    // in the listing because they were tracked before the negation was added.
    const sanctioned = [
      /^\.agents\/skills\/work-with-pr-workspace\/.*\/outputs\//,
      /^\.opencode\/skills\/work-with-pr-workspace\/.*\/outputs\//,
      /^packages\/omo-codex\/plugin\/skills\//,
      /^packages\/omo-senpi\/plugin\/skills\//,
      /^\.omo\/fixtures\//,
      /^\.omo\/init-deep\.json$/,
    ]

    const strays = tracked.filter(
      (p) => !sanctioned.some((re) => re.test(p)),
    )

    expect(strays).toEqual([])
  })
})
