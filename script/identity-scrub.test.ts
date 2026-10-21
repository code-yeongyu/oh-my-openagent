/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

// Project-wide identity-scrub guard.
//
// When this test fails, it means a committed file (code, comment, fixture,
// PR body, evidence file, docs) contains an operational-identifier pattern
// tied to one contributor's deployment. The repo learned this rule after a
// 2026-10 PR shipped `https://dgx.cloudbsd.org/v1` and `~/.creds/dgx-mlapointe/
// litellm-key` into a test fixture and PR body, which is exactly the kind of
// operational correlation this guard exists to catch.
//
// To extend the rule: edit script/identity-scrub-patterns.json (only), commit
// the new entry alongside an updated CONTRIBUTING.md and AGENTS.md entry that
// describes the new category. Adding entries goes through normal PR review
// because the list is the audit trail.

interface Pattern {
  readonly id: string
  readonly regex: RegExp
  readonly rationale: string
}

const RAW = (await Bun.file(
  join(import.meta.dir, "identity-scrub-patterns.json"),
).json()) as Array<{ id: string; regex: string; rationale: string; flags?: string }>

const PATTERNS: readonly Pattern[] = RAW.map((p) => ({
  ...p,
  regex: new RegExp(p.regex, p.flags ?? "i"),
}))

const IGNORE_DIRS: readonly string[] = [
  "node_modules",
  ".git",
  "dist",
  ".omo",
  ".local-ignore",
  "binary-runtime",
  "plugin",
]

// Files that legitimately reference the patterns by virtue of *being* the
// rule itself.
const IGNORE_FILES: ReadonlySet<string> = new Set([
  "script/identity-scrub.test.ts",
  "script/identity-scrub-patterns.json",
  // The rule docs: the patterns are spelled out in CONTRIBUTING.md, AGENTS.md,
  // and the pattern JSON itself. Adding entries here is itself a reviewable
  // change.
  "CONTRIBUTING.md",
  "AGENTS.md",
  "docs/security/identity-scrub.md",
  "docs/security/identity-scrub-rules.md",
])

interface Violation {
  readonly id: string
  readonly path: string
  readonly line: number
  readonly content: string
}

const REPO_ROOT = join(import.meta.dir, "..")

interface GitGrepResult {
  readonly files: readonly string[]
  readonly status: number
}

function gitGrep(args: readonly string[]): GitGrepResult {
  const proc = spawnSync("git", ["grep", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  // git grep returns 1 on "no match" — that is success for our purposes.
  if (proc.status !== 0 && proc.status !== 1) {
    throw new Error(
      `git grep exited ${proc.status}: ${proc.stderr.slice(0, 500)}`,
    )
  }
  const files = proc.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
  return { files, status: proc.status ?? 0 }
}

describe("identity-scrub guard", () => {
  test(
    "no operational-identifier PII appears in any committed file",
    async () => {
      // Stage 1: per-pattern git grep over the tracked tree. git grep only
      // walks tracked files, so gitignored dirs (`.omo`, `.local-ignore`,
      // `dist`, `node_modules`, `.git`, `binary-runtime`, `plugin`) are
      // already excluded. The only files we still need to skip are the rule's
      // own defining docs.
      const candidates = new Set<string>()
      for (const p of PATTERNS) {
        const proc = spawnSync(
          "git",
          ["grep", "-lIE", "-e", p.regex.source],
          { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        )
        if (proc.status !== 0 && proc.status !== 1) {
          throw new Error(
            `git grep exited ${proc.status}: ${proc.stderr.slice(0, 500)}`,
          )
        }
        for (const line of proc.stdout.split("\n")) {
          const trimmed = line.trim()
          if (trimmed) candidates.add(trimmed)
        }
      }

      // Stage 2: for each candidate, find which pattern(s) match and where.
      const violations: Violation[] = []
      for (const rel of candidates) {
        if (IGNORE_FILES.has(rel)) continue
        const file = Bun.file(join(REPO_ROOT, rel))
        if (file.size > 5_000_000) continue
        const text = await file.text()
        const lines = text.split("\n")
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          for (const p of PATTERNS) {
            if (p.regex.test(line)) {
              violations.push({
                id: p.id,
                path: rel,
                line: i + 1,
                content: line.slice(0, 200),
              })
              break
            }
          }
        }
      }

      expect(violations).toEqual([])
    },
    60_000,
  )

  test("the pattern list is non-empty and every entry is well-formed", () => {
    expect(PATTERNS.length).toBeGreaterThan(0)
    for (const p of PATTERNS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/)
      expect(p.regex).toBeInstanceOf(RegExp)
      expect(p.regex.flags).toContain("i")
      expect(p.rationale.length).toBeGreaterThan(20)
    }
  })
})
