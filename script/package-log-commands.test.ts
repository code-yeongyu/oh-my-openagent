import { describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { markerLine, splitFragment } from "./package-log-blocks.ts"

// Each case spawns git and bun several times (about 4 s alone), so it gets a budget above bun's 5 s default.
const SPAWN_TIMEOUT_MS = 30_000
const SCRIPT_DIR = import.meta.dir
const LOG = "packages/omo-senpi/changes.md"
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV })
const commit = (cwd: string, message: string) => { git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", message) }
const bun = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync("bun", args, { cwd, encoding: "utf8", env: { ...ENV, ...env } })

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "package-log-commands-"))
  git(dir, "init", "-q", "-b", "dev")
  cpSync(SCRIPT_DIR, join(dir, "script"), { recursive: true, filter: (p) => !p.includes("node_modules") })
  mkdirSync(join(dir, "packages/omo-senpi"), { recursive: true })
  mkdirSync(join(dir, "changes/unreleased"), { recursive: true })
  writeFileSync(join(dir, LOG), "# omo-senpi changes\n\n## 2026-10-01 - old\n")
  writeFileSync(join(dir, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-10-01\n\nold\n")
  commit(dir, "base")
  return dir
}

describe("the gate runner's release decision (#10682 review HIGH)", () => {
  const gate = (dir: string, branch: string, actor: string, extra: Record<string, string> = {}) =>
    bun(dir, ["script/check-pr-changelog.ts"], {
      CHANGELOG_GATE_BASE: git(dir, "rev-parse", "dev").trim(), CHANGELOG_GATE_BRANCH: branch, CHANGELOG_GATE_ACTOR: actor,
      CHANGELOG_GATE_RELEASE: branch.startsWith("release/") ? "1" : "0", CHANGELOG_GATE_PR: "7", CHANGELOG_GATE_LABELS: "[]", ...extra,
    })

  test("a release/* branch from an ordinary author cannot edit a package log", () => {
    const dir = scratch()
    try {
      git(dir, "checkout", "-q", "-b", "release/x")
      writeFileSync(join(dir, LOG), "# omo-senpi changes\n\n## 2026-10-20 - direct\n\n## 2026-10-01 - old\n")
      writeFileSync(join(dir, "changes/unreleased/7.md"), "**p** ([#7](u))\n")
      commit(dir, "direct edit")
      const result = gate(dir, "release/x", "random-user")
      expect(result.status).toBe(1)
      expect(result.stdout).toContain("package logs FAIL")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS)
})

describe("stamp-release-changelog.ts with package-log blocks", () => {
  test("only paragraphs reach CHANGELOG.md; leftover blocks land in their logs; fragments are consumed", () => {
    const dir = scratch()
    try {
      writeFileSync(join(dir, "changes/unreleased/8.md"), `**eight** ([#8](u))\n\n${markerLine(LOG)}\n## 2026-10-20 - eight (#8)\n`)
      writeFileSync(join(dir, "changes/unreleased/9.md"), `${markerLine(LOG)}\n## 2026-10-20 - nine (#9)\n`)
      const result = bun(dir, ["script/stamp-release-changelog.ts", "9.9.9", "2026-10-20"])
      expect(result.status).toBe(0)
      const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8")
      expect(changelog).toContain("**eight**")
      expect(changelog).not.toContain("changes-log")
      expect(changelog).not.toContain("nine (#9)")
      expect(readFileSync(join(dir, LOG), "utf8")).toBe("# omo-senpi changes\n\n## 2026-10-20 - nine (#9)\n\n## 2026-10-20 - eight (#8)\n\n## 2026-10-01 - old\n")
      expect(git(dir, "status", "--porcelain", "changes/unreleased")).not.toContain("8.md\n?")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS)

  test("a release whose fragments carry no paragraph is refused and writes nothing", () => {
    const dir = scratch()
    try {
      writeFileSync(join(dir, "changes/unreleased/9.md"), `${markerLine(LOG)}\n## 2026-10-20 - nine (#9)\n`)
      const before = readFileSync(join(dir, LOG), "utf8")
      const result = bun(dir, ["script/stamp-release-changelog.ts", "9.9.9", "2026-10-20"])
      expect(result.status).not.toBe(0)
      expect(readFileSync(join(dir, LOG), "utf8")).toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS)
})

describe("changelog-fragments-cli.ts from-diff on package logs", () => {
  test("from-diff converts against the merge base even after dev's log moved (#10682 review MEDIUM 2)", () => {
    const dir = scratch()
    try {
      git(dir, "checkout", "-q", "-b", "feat")
      writeFileSync(join(dir, LOG), "# omo-senpi changes\n\n## 2026-10-20 - mine (#12)\n\n## 2026-10-01 - old\n")
      commit(dir, "old-style edit")
      git(dir, "checkout", "-q", "dev")
      writeFileSync(join(dir, LOG), "# omo-senpi changes\n\n## 2026-10-19 - compiled on dev\n\n## 2026-10-01 - old\n")
      commit(dir, "dev moved")
      git(dir, "checkout", "-q", "feat")
      const result = bun(dir, ["script/changelog-fragments-cli.ts", "from-diff", "--base", "dev", "--pr", "12"])
      expect(result.status).toBe(0)
      expect(splitFragment(readFileSync(join(dir, "changes/unreleased/12.md"), "utf8")).blocks).toEqual([{ log: LOG, body: "## 2026-10-20 - mine (#12)" }])
      expect(readFileSync(join(dir, LOG), "utf8")).toBe("# omo-senpi changes\n\n## 2026-10-01 - old\n")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS)
})

test("block targets with dot segments or escapes are refused (#10682 review LOW 4)", () => {
  for (const log of ["packages/../changes.md", "packages/./changes.md", "packages/%2e%2e/changes.md", "packages/a/../changes.md"]) {
    expect(splitFragment(`${markerLine(log)}\n## 2026-10-20 - x`).reasons.length).toBeGreaterThan(0)
  }
})
