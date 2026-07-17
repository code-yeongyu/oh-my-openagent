import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

const TEAM_DIR = import.meta.dir

const ALLOWED_TEAM_CORE_SUBPATHS: ReadonlySet<string> = new Set([
  "@oh-my-opencode/team-core/team-registry",
  "@oh-my-opencode/team-core/team-mailbox",
  "@oh-my-opencode/team-core/team-tasklist",
  "@oh-my-opencode/team-core/team-state-store",
  "@oh-my-opencode/team-core/types",
  "@oh-my-opencode/team-core/config",
])

const FORBIDDEN_SPECIFIERS: readonly string[] = [
  "@oh-my-opencode/team-core/team-worktree",
  "@oh-my-opencode/team-core/team-layout-tmux",
  "@oh-my-opencode/team-core/team-state-store/session-liveness",
  "@oh-my-opencode/team-core/team-mailbox/pending-delivery-recovery",
  "@oh-my-opencode/tmux-core",
]

function listTeamSourceFiles(): readonly string[] {
  // Recursive so nested team-layer modules (messaging/, tasklist/, ...) are covered, not just the
  // top-level directory. readdirSync recursive returns paths relative to TEAM_DIR.
  return readdirSync(TEAM_DIR, { recursive: true })
    .map((entry) => String(entry))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(TEAM_DIR, name))
}

function extractImportSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = []
  const pattern = /(?:from|import)\s*["']([^"']+)["']/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier) specifiers.push(specifier)
  }
  return specifiers
}

describe("team layer import discipline", () => {
  test("#given the team layer source files #when their imports are scanned #then no forbidden team-core or opencode/tmux specifier is used", () => {
    // given
    const files = listTeamSourceFiles()

    // when
    const violations: string[] = []
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      for (const specifier of extractImportSpecifiers(source)) {
        const isForbidden =
          FORBIDDEN_SPECIFIERS.includes(specifier) ||
          specifier === "@oh-my-opencode/team-core" ||
          specifier.includes("/team-core/src/") ||
          specifier.includes("team-mode") ||
          specifier.startsWith("@opencode-ai/") ||
          specifier === "@oh-my-opencode/omo-opencode"
        if (isForbidden) violations.push(`${file}: ${specifier}`)
      }
    }

    // then
    expect(violations).toEqual([])
  })

  test("#given team-core imports #when scanned #then only exported subpaths are used", () => {
    // given
    const files = listTeamSourceFiles()

    // when
    const disallowed: string[] = []
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      for (const specifier of extractImportSpecifiers(source)) {
        if (specifier.startsWith("@oh-my-opencode/team-core") && !ALLOWED_TEAM_CORE_SUBPATHS.has(specifier)) {
          disallowed.push(`${file}: ${specifier}`)
        }
      }
    }

    // then
    expect(disallowed).toEqual([])
  })
})
