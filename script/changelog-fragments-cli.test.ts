import { describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { markerLine, splitFragment } from "./package-log-blocks.ts"

// The migration (#10841) and the bundle train both run this CLI on real branches, so every case drives a real git
// repository and then the real PR gate, the way CI judges the converted or folded branch.
const SCRIPT_DIR = import.meta.dir
const LOG = "packages/omo-senpi/changes.md"
const PULL = "https://github.com/code-yeongyu/oh-my-openagent/pull"
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
// Each case spawns git and bun several times (about 4 s alone), so it gets a budget above bun's 5 s default.
const SPAWN_TIMEOUT_MS = 30_000
const CHANGELOG = "# Changelog\n\n## [Unreleased]\n\n**Old entry.** ([#1](u))\n\n## [1.0.0] - 2026-10-01\n\nold\n"

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV })
const commit = (cwd: string, message: string) => { git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", message) }
const bun = (cwd: string, args: string[], env: Record<string, string> = {}) => spawnSync("bun", args, { cwd, encoding: "utf8", env: { ...ENV, ...env } })
const write = (dir: string, path: string, content: string) => { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), content) }
const read = (dir: string, path: string) => readFileSync(join(dir, path), "utf8")

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "changelog-fragments-cli-"))
  git(dir, "init", "-q", "-b", "dev")
  cpSync(SCRIPT_DIR, join(dir, "script"), { recursive: true, filter: (p) => !p.includes("node_modules") })
  write(dir, "package.json", JSON.stringify({ files: ["packages/omo-senpi/src"] }))
  write(dir, "packages/omo-senpi/src/index.ts", "export const v = 1\n")
  write(dir, LOG, "# omo-senpi changes\n\n## 2026-10-01 - old\n")
  write(dir, "changes.md", "## 2026-10-01 - root old\n")
  write(dir, "changes/unreleased/README.md", "fragments\n")
  write(dir, "CHANGELOG.md", CHANGELOG)
  commit(dir, "base")
  return dir
}

const gate = (dir: string, pr: number) => bun(dir, ["script/check-pr-changelog.ts"], {
  CHANGELOG_GATE_BASE: git(dir, "rev-parse", "dev").trim(), CHANGELOG_GATE_BRANCH: "feat", CHANGELOG_GATE_ACTOR: "contributor",
  CHANGELOG_GATE_RELEASE: "0", CHANGELOG_GATE_PR: String(pr), CHANGELOG_GATE_LABELS: "[]",
})

const withScratch = (body: (dir: string) => void) => () => {
  const dir = scratch()
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("from-diff converts an open branch written before fragments (#10841 migration)", () => {
  test("an Unreleased paragraph, a root changes.md entry and a package-log entry all move into the PR's fragment", withScratch((dir) => {
    // given: a branch that edits all three shared files the old way, after dev moved its Unreleased section
    git(dir, "checkout", "-q", "-b", "feat")
    write(dir, "packages/omo-senpi/src/index.ts", "export const v = 2\n")
    write(dir, "CHANGELOG.md", CHANGELOG.replace("## [Unreleased]\n\n", `## [Unreleased]\n\n**Mine.** ([#12](${PULL}/12))\n\n`))
    write(dir, "changes.md", "## 2026-10-20 - root mine (#12)\n\nwhy\n\n## 2026-10-01 - root old\n")
    write(dir, LOG, "# omo-senpi changes\n\n## 2026-10-20 - mine (#12)\n\n## 2026-10-01 - old\n")
    commit(dir, "old-style entries")
    git(dir, "checkout", "-q", "dev")
    write(dir, "CHANGELOG.md", CHANGELOG.replace("## [Unreleased]\n\n", "## [Unreleased]\n\n**Dev moved.** ([#11](u))\n\n"))
    commit(dir, "dev moved")
    git(dir, "checkout", "-q", "feat")
    expect(gate(dir, 12).status).toBe(1)

    // when
    const result = bun(dir, ["script/changelog-fragments-cli.ts", "from-diff", "--base", "dev", "--pr", "12"])
    expect(result.status, result.stderr).toBe(0)
    commit(dir, "convert")

    // then: the shared files are back to the merge base, the fragment holds every entry, and the gate passes
    const split = splitFragment(read(dir, "changes/unreleased/12.md"))
    expect(split.reasons).toEqual([])
    expect(split.preamble).toBe(`**Mine.** ([#12](${PULL}/12))`)
    expect(split.blocks).toEqual([
      { log: "changes.md", body: "## 2026-10-20 - root mine (#12)\n\nwhy" },
      { log: LOG, body: "## 2026-10-20 - mine (#12)" },
    ])
    expect(read(dir, "CHANGELOG.md")).toBe(CHANGELOG)
    expect(read(dir, "changes.md")).toBe("## 2026-10-01 - root old\n")
    const verdict = gate(dir, 12)
    expect(verdict.status, verdict.stdout + verdict.stderr).toBe(0)
  }), SPAWN_TIMEOUT_MS)

  test("an edit to a released section is refused and nothing is written", withScratch((dir) => {
    // given
    git(dir, "checkout", "-q", "-b", "feat")
    write(dir, "CHANGELOG.md", CHANGELOG.replace("\nold\n", "\nrewritten\n"))
    commit(dir, "edits history")
    // when
    const result = bun(dir, ["script/changelog-fragments-cli.ts", "from-diff", "--base", "dev", "--pr", "12"])
    // then
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("outside ## [Unreleased]")
    expect(existsSync(join(dir, "changes/unreleased/12.md"))).toBe(false)
    expect(git(dir, "status", "--porcelain")).toBe("")
  }), SPAWN_TIMEOUT_MS)
})

test("from-diff refuses, and keeps the file, when a changelog file has uncommitted edits", withScratch((dir) => {
  // given: a committed old-style entry plus an uncommitted edit to the same log (#10477 review LOW 9)
  git(dir, "checkout", "-q", "-b", "feat")
  write(dir, LOG, "# omo-senpi changes\n\n## 2026-10-20 - mine (#12)\n\n## 2026-10-01 - old\n")
  commit(dir, "old-style edit")
  write(dir, LOG, "# omo-senpi changes\n\n## 2026-10-20 - mine, still typing (#12)\n\n## 2026-10-01 - old\n")
  // when
  const result = bun(dir, ["script/changelog-fragments-cli.ts", "from-diff", "--base", "dev", "--pr", "12"])
  // then
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain("uncommitted")
  expect(read(dir, LOG)).toContain("still typing")
  expect(existsSync(join(dir, "changes/unreleased/12.md"))).toBe(false)
}), SPAWN_TIMEOUT_MS)

describe("fold-batch merges the cars' fragments into the batch PR's own (bundle train)", () => {
  test("two cars with paragraphs, sections and blocks for the same log become one fragment the gate accepts", withScratch((dir) => {
    // given: a batch branch that merged two car branches, each carrying its own fragment
    git(dir, "checkout", "-q", "-b", "batch")
    write(dir, "packages/omo-senpi/src/index.ts", "export const v = 3\n")
    write(dir, "changes/unreleased/20.md", `**Car twenty.** ([#20](${PULL}/20))\r\n\r\n${markerLine(LOG)}\r\n## 2026-10-24 - twenty (#20)\r\n`)
    write(dir, "changes/unreleased/21.md", `### Fixed\n\n- Car twenty-one. ([#21](${PULL}/21))\n\n${markerLine(LOG)}\n## 2026-10-24 - twenty-one (#21)\n`)
    commit(dir, "batch: merge #20 and #21")
    expect(gate(dir, 30).status).toBe(1)

    // when
    const result = bun(dir, ["script/changelog-fragments-cli.ts", "fold-batch", "--base", "dev", "--pr", "30"])
    expect(result.status, result.stderr).toBe(0)
    commit(dir, "fold")

    // then: paragraphs before ### groups, one block per log (newest car first), the car files gone, and the gate passes
    const split = splitFragment(read(dir, "changes/unreleased/30.md"))
    expect(split.reasons).toEqual([])
    expect(split.preamble).toBe(`**Car twenty.** ([#20](${PULL}/20))\n\n### Fixed\n\n- Car twenty-one. ([#21](${PULL}/21))`)
    expect(split.blocks).toEqual([{ log: LOG, body: "## 2026-10-24 - twenty-one (#21)\n\n## 2026-10-24 - twenty (#20)" }])
    expect(existsSync(join(dir, "changes/unreleased/20.md"))).toBe(false)
    expect(existsSync(join(dir, "changes/unreleased/21.md"))).toBe(false)
    const verdict = gate(dir, 30)
    expect(verdict.status, verdict.stdout + verdict.stderr).toBe(0)
  }), SPAWN_TIMEOUT_MS)
})
