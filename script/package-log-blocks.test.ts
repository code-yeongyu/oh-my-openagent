import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { blockFromPrepend, compileBlocks, markerLine, prependToLog, splitFragment } from "./package-log-blocks.ts"

const LOG = "packages/omo-senpi/changes.md"
const OTHER = "packages/senpi-task/changes.md"
const fragment = (preamble: string, ...blocks: [string, string][]) =>
  [preamble, ...blocks.map(([log, body]) => `${markerLine(log)}\n${body}`)].filter(Boolean).join("\n\n")

describe("splitFragment", () => {
  test("separates the CHANGELOG preamble from the package-log blocks", () => {
    const split = splitFragment(fragment("**User text** ([#7](u))", [LOG, "## 2026-10-20 - A (#7)\n\nbody"], [OTHER, "## 2026-10-20 — B (#7)"]))
    expect(split.reasons).toEqual([])
    expect(split.preamble).toBe("**User text** ([#7](u))")
    expect(split.blocks).toEqual([{ log: LOG, body: "## 2026-10-20 - A (#7)\n\nbody" }, { log: OTHER, body: "## 2026-10-20 — B (#7)" }])
  })

  test("a fragment with no block is just its preamble (the #10477 format, unchanged)", () => {
    expect(splitFragment("**Only text**\n")).toEqual({ preamble: "**Only text**", blocks: [], reasons: [] })
  })

  test("the root changes.md is a log target too: its notes stop conflicting the same way", () => {
    expect(splitFragment(fragment("", ["changes.md", "## 2026-10-20 - x"])).reasons).toEqual([])
  })

  test("refuses a non-log target, a duplicate target, an undated heading and conflict markers", () => {
    expect(splitFragment(fragment("", ["docs/changes.md", "## 2026-10-20 - x"])).reasons[0]).toContain("is not a change log")
    expect(splitFragment(fragment("", [LOG, "## 2026-10-20 - a"], [LOG, "## 2026-10-20 - b"])).reasons).toContain(`\`${LOG}\` has two blocks; write one`)
    expect(splitFragment(fragment("", [LOG, "## Title"])).reasons[0]).toContain("must start with")
    expect(splitFragment(fragment("", [LOG, "## 2026-10-20 - a\n<<<<<<< HEAD"])).reasons).toContain("the fragment holds a merge-conflict marker")
  })
})

describe("compileBlocks", () => {
  test("writes blocks newest PR first on top of each log and keeps only the preamble", () => {
    const logs: Record<string, string> = { [LOG]: "# omo-senpi changes\n\n## 2026-10-01 - old\n" }
    const result = compileBlocks(
      [
        { pr: 10, content: fragment("**ten**", [LOG, "## 2026-10-20 - ten (#10)"]) },
        { pr: 12, content: fragment("", [LOG, "## 2026-10-20 - twelve (#12)"]) },
      ],
      (path) => logs[path] ?? null,
    )
    expect(result.logs.get(LOG)).toBe("# omo-senpi changes\n\n## 2026-10-20 - twelve (#12)\n\n## 2026-10-20 - ten (#10)\n\n## 2026-10-01 - old\n")
    expect(result.fragments.get(10)).toBe("**ten**\n")
    expect(result.fragments.get(12)).toBeNull()
  })

  test("is all-or-nothing: an invalid fragment or a missing log throws", () => {
    expect(() => compileBlocks([{ pr: 1, content: fragment("", [LOG, "## nope"]) }], () => "")).toThrow("fragment #1")
    expect(() => compileBlocks([{ pr: 1, content: fragment("", [OTHER, "## 2026-10-20 - x"]) }], () => null)).toThrow("does not exist")
  })

  test("a log without a title line gets the entries at its very top", () => {
    expect(prependToLog("first paragraph\n", ["## 2026-10-20 - new"])).toBe("## 2026-10-20 - new\n\nfirst paragraph\n")
  })
})

describe("blockFromPrepend (converting an open branch)", () => {
  test("the text a branch prepended becomes a block; an edit below the top is refused", () => {
    const base = "# t\n\n## 2026-10-01 - old\n"
    expect(blockFromPrepend(LOG, base, "# t\n\n## 2026-10-20 - new\n\n## 2026-10-01 - old\n")).toEqual({ log: LOG, body: "## 2026-10-20 - new" })
    expect(blockFromPrepend(LOG, base, "# t\n\n## 2026-10-01 - edited\n")).toBeNull()
  })
})

describe("two open PRs writing to the same package log", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } })
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "package-log-blocks-"))
    git(dir, "init", "-q", "-b", "dev")
    mkdirSync(join(dir, "packages/omo-senpi"), { recursive: true })
    writeFileSync(join(dir, LOG), "# omo-senpi changes\n\n## 2026-10-01 - old\n")
    git(dir, "add", "-A")
    git(dir, "commit", "-q", "-m", "base")
    return dir
  }
  const branch = (dir: string, name: string, path: string, content: string) => {
    git(dir, "checkout", "-q", "-b", name, "dev")
    mkdirSync(join(dir, path, ".."), { recursive: true })
    writeFileSync(join(dir, path), content)
    git(dir, "add", "-A")
    git(dir, "commit", "-q", "-m", name)
  }
  const mergeBoth = (dir: string): boolean => {
    git(dir, "checkout", "-q", "dev")
    git(dir, "merge", "-q", "--no-ff", "a", "-m", "a")
    try {
      git(dir, "merge", "-q", "--no-ff", "b", "-m", "b")
      return true
    } catch {
      return false
    }
  }

  test("RED: prepending to the log directly makes the second merge conflict", () => {
    const dir = repo()
    try {
      branch(dir, "a", LOG, "# omo-senpi changes\n\n## 2026-10-20 - a (#1)\n\n## 2026-10-01 - old\n")
      branch(dir, "b", LOG, "# omo-senpi changes\n\n## 2026-10-20 - b (#2)\n\n## 2026-10-01 - old\n")
      expect(mergeBoth(dir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("GREEN: one fragment per PR merges cleanly, and the compile keeps both entries newest first", () => {
    const dir = repo()
    try {
      branch(dir, "a", "changes/unreleased/1.md", fragment("**one**", [LOG, "## 2026-10-20 - a (#1)"]))
      branch(dir, "b", "changes/unreleased/2.md", fragment("**two**", [LOG, "## 2026-10-20 - b (#2)"]))
      expect(mergeBoth(dir)).toBe(true)
      const read = (path: string) => git(dir, "show", `dev:${path}`)
      const result = compileBlocks([1, 2].map((pr) => ({ pr, content: read(`changes/unreleased/${pr}.md`) })), read)
      expect(result.logs.get(LOG)).toBe("# omo-senpi changes\n\n## 2026-10-20 - b (#2)\n\n## 2026-10-20 - a (#1)\n\n## 2026-10-01 - old\n")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
