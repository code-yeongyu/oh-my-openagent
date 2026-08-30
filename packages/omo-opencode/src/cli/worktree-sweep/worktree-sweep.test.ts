/// <reference types="bun-types" />
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { DEFAULT_EXCLUDE_PREFIXES, isExcludedPath } from "./classify"
import { formatClassification, formatSummary } from "./format"
import { linkedWorktrees, parseWorktreeList } from "./parse-worktree-list"
import { parseOlderThanDays } from "./options"
import { sweepWorktrees } from "./sweep"
import { worktreeSweep } from "./worktree-sweep"
import type { WorktreeSweepRepoReport } from "./types"

const DAY_MS = 24 * 60 * 60 * 1000
const temporaryDirectories: string[] = []

afterAll(async () => {
  for (const directory of temporaryDirectories.reverse()) {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: GIT_ENV,
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`)
  }
  return result.stdout
}

async function commit(repo: string, message: string): Promise<void> {
  git(repo, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    message,
  ])
}

async function newTmpDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  // macOS hands out /var/folders/... while git reports /private/var/folders/...;
  // normalizing up front keeps porcelain output comparable.
  return fs.realpath(directory)
}

interface Fixture {
  readonly base: string
  readonly repo: string
}

/** Main worktree on `main` with one commit; linked worktrees are added by each test. */
async function createFixture(prefix = "wt-sweep-"): Promise<Fixture> {
  const base = await newTmpDir(prefix)
  const repo = path.join(base, "repo")
  await fs.mkdir(repo)
  git(repo, ["init", "-b", "main"])
  await commit(repo, "initial")
  return { base, repo }
}

/**
 * Creates branch `name` with one commit, fast-forwards `main` to it (so the
 * branch is merged), then checks the branch out in a linked worktree.
 */
async function addMergedWorktree(repo: string, name: string, worktreePath: string): Promise<void> {
  git(repo, ["branch", name])
  git(repo, ["merge", "--ff-only", name])
  git(repo, ["worktree", "add", worktreePath, name])
}

/** Same as addMergedWorktree but leaves the branch unmerged. */
async function addUnmergedWorktree(repo: string, name: string, worktreePath: string): Promise<void> {
  git(repo, ["checkout", "-b", name])
  await commit(repo, `${name} commit`)
  git(repo, ["checkout", "main"])
  git(repo, ["worktree", "add", worktreePath, name])
}

function decisionFor(report: WorktreeSweepRepoReport, worktreePath: string) {
  const classification = report.classifications.find((item) => item.path === worktreePath)
  if (classification === undefined) {
    throw new Error(`no classification for ${worktreePath}; got ${JSON.stringify(report.classifications)}`)
  }
  return classification
}

/** git porcelain output always uses forward separators, even on Windows. */
const toPosix = (value: string): string => value.split(path.sep).join("/")

describe("parseWorktreeList", () => {
  test("parses main worktree, locked reason, detached, and prunable records", () => {
    const porcelain = [
      "worktree /repos/omo",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /tmp/wt-a",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feature",
      "locked review:pr-1",
      "",
      "worktree /tmp/wt-b",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "",
      "worktree /tmp/wt-gone",
      "HEAD 4444444444444444444444444444444444444444",
      "branch refs/heads/gone",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n")

    const records = parseWorktreeList(porcelain)

    expect(records).toHaveLength(4)
    expect(records[0]).toEqual({
      path: path.normalize("/repos/omo"),
      head: "1111111111111111111111111111111111111111",
      branch: "main",
      detached: false,
      locked: false,
      prunable: false,
    })
    expect(records[1]?.branch).toBe("feature")
    expect(records[1]?.locked).toBe(true)
    expect(records[1]?.lockReason).toBe("review:pr-1")
    expect(records[2]?.detached).toBe(true)
    expect(records[2]?.branch).toBeUndefined()
    expect(records[3]?.prunable).toBe(true)
    // First record is the main worktree and is always excluded from candidates.
    expect(linkedWorktrees(records).map((record) => record.path)).toEqual(
      ["/tmp/wt-a", "/tmp/wt-b", "/tmp/wt-gone"].map(path.normalize),
    )
  })

  test("accepts output without a trailing blank line", () => {
    const records = parseWorktreeList("worktree /a\nHEAD 1\nbranch refs/heads/main")
    expect(records).toHaveLength(1)
    expect(records[0]?.path).toBe(path.normalize("/a"))
  })

  test("normalizes worktree paths so separator and dot segments cannot split identity", () => {
    const records = parseWorktreeList(
      ["worktree /tmp/sweep/./wt-x", "HEAD 1", "branch refs/heads/main"].join("\n"),
    )
    expect(records[0]?.path).toBe(path.normalize("/tmp/sweep/wt-x"))
  })
})

describe("isExcludedPath", () => {
  test("default exclude prefixes protect codex-managed worktree roots", () => {
    expect(isExcludedPath("/home/dev/.codex/worktrees/lane-a", DEFAULT_EXCLUDE_PREFIXES, "/home/dev")).toBe(true)
    expect(
      isExcludedPath("/home/dev/.codex-gui-cli-remote/worktrees/pr-9", DEFAULT_EXCLUDE_PREFIXES, "/home/dev"),
    ).toBe(true)
  })

  test("paths outside the prefixes are not excluded, and prefix siblings do not match", () => {
    expect(isExcludedPath("/home/dev/src/omo", DEFAULT_EXCLUDE_PREFIXES, "/home/dev")).toBe(false)
    expect(isExcludedPath("/home/dev/.codex-other/worktrees/x", DEFAULT_EXCLUDE_PREFIXES, "/home/dev")).toBe(false)
  })
})

describe("parseOlderThanDays", () => {
  test("accepts non-negative integers and rejects everything else", () => {
    expect(parseOlderThanDays("0")).toBe(0)
    expect(parseOlderThanDays("14")).toBe(14)
    expect(() => parseOlderThanDays("-1")).toThrow()
    expect(() => parseOlderThanDays("1.5")).toThrow()
    expect(() => parseOlderThanDays("soon")).toThrow()
  })
})

describe("sweepWorktrees classification", () => {
  test("classifies merged, unmerged, dirty, locked, excluded, missing, and detached worktrees", async () => {
    const { base, repo } = await createFixture()

    const merged = path.join(base, "wt-merged")
    const unmerged = path.join(base, "wt-unmerged")
    const dirty = path.join(base, "wt-dirty")
    const locked = path.join(base, "wt-locked")
    const external = path.join(base, "external", "wt-external")
    const missing = path.join(base, "wt-missing")
    const detached = path.join(base, "wt-detached")

    await addMergedWorktree(repo, "merged-branch", merged)
    await addUnmergedWorktree(repo, "unmerged-branch", unmerged)
    await addMergedWorktree(repo, "dirty-branch", dirty)
    await fs.writeFile(path.join(dirty, "scratch.txt"), "local change\n")
    await addMergedWorktree(repo, "locked-branch", locked)
    git(repo, ["worktree", "lock", locked])
    await fs.mkdir(path.dirname(external), { recursive: true })
    await addMergedWorktree(repo, "external-branch", external)
    await addMergedWorktree(repo, "missing-branch", missing)
    await fs.rm(missing, { recursive: true, force: true })
    const mergedTip = git(repo, ["rev-parse", "merged-branch"]).trim()
    git(repo, ["worktree", "add", "--detach", detached, mergedTip])

    const result = await sweepWorktrees({
      repos: [repo],
      excludePrefixes: [path.join(base, "external")],
    })

    expect(result.repos).toHaveLength(1)
    const report = result.repos[0]!
    expect(report.defaultBranch).toBe("main")

    const mergedItem = decisionFor(report, merged)
    expect(mergedItem.decision).toBe("SWEEP")
    expect(mergedItem.ref).toBe("merged-branch")

    expect(decisionFor(report, unmerged)).toEqual({
      path: unmerged,
      ref: "unmerged-branch",
      decision: "KEEP",
      reason: "unmerged",
    })
    expect(decisionFor(report, dirty).reason).toBe("dirty")
    expect(decisionFor(report, locked).reason).toBe("locked")
    expect(decisionFor(report, external).reason).toBe("external")
    expect(decisionFor(report, missing).decision).toBe("PRUNE")
    // Detached trees are judged by their HEAD sha, which is merged here.
    expect(decisionFor(report, detached)).toEqual({
      path: detached,
      ref: mergedTip,
      decision: "SWEEP",
    })

    // The main worktree itself is never a candidate.
    expect(report.classifications.some((item) => item.path === repo)).toBe(false)

    expect(result.sweepCount).toBe(2)
    expect(result.keepCount).toBe(4)
    expect(result.pruneCount).toBe(1)
    expect(result.apply).toBe(false)

    // Dry-run removed nothing.
    expect(await fs.stat(merged)).toBeTruthy()
    expect(git(repo, ["worktree", "list", "--porcelain"])).toContain(toPosix(missing))
  })

  test("detects the default branch through origin/HEAD when present", async () => {
    const base = await newTmpDir("wt-sweep-origin-")
    const seed = path.join(base, "seed")
    const origin = path.join(base, "origin.git")
    const clone = path.join(base, "clone")

    await fs.mkdir(seed)
    git(seed, ["init", "-b", "trunk"])
    await commit(seed, "initial")
    git(seed, ["clone", "--bare", seed, origin])
    git(seed, ["clone", origin, clone])

    git(clone, ["checkout", "-b", "feature"])
    await commit(clone, "feature commit")
    git(clone, ["checkout", "trunk"])
    git(clone, ["merge", "--ff-only", "feature"])
    const feature = path.join(base, "wt-feature")
    git(clone, ["worktree", "add", feature, "feature"])

    const result = await sweepWorktrees({ repos: [clone] })
    const report = result.repos[0]!

    expect(report.defaultBranch).toBe("trunk")
    expect(decisionFor(report, feature).decision).toBe("SWEEP")
  }, { timeout: 30_000 })

  test("falls back to master when origin/HEAD and main are absent", async () => {
    const { base, repo } = await createFixture("wt-sweep-master-")
    git(repo, ["branch", "-m", "main", "master"])

    const worktree = path.join(base, "wt-m")
    git(repo, ["branch", "done"])
    git(repo, ["merge", "--ff-only", "done"])
    git(repo, ["worktree", "add", worktree, "done"])

    const result = await sweepWorktrees({ repos: [repo] })
    expect(result.repos[0]?.defaultBranch).toBe("master")
    expect(decisionFor(result.repos[0]!, worktree).decision).toBe("SWEEP")
  })
})

describe("sweepWorktrees --older-than", () => {
  test("unmerged worktrees are kept when newer than the cutoff and swept when older and clean", async () => {
    const { base, repo } = await createFixture("wt-sweep-age-")
    const young = path.join(base, "wt-young")
    const old = path.join(base, "wt-old")
    const oldDirty = path.join(base, "wt-old-dirty")

    await addUnmergedWorktree(repo, "young-branch", young)
    await addUnmergedWorktree(repo, "old-branch", old)
    await addUnmergedWorktree(repo, "old-dirty-branch", oldDirty)
    // The untracked file first (writing it would touch the directory mtime), then age the directory.
    await fs.writeFile(path.join(oldDirty, "scratch.txt"), "local change\n")
    const staleTime = new Date(Date.now() - 10 * DAY_MS)
    await fs.utimes(old, staleTime, staleTime)
    await fs.utimes(oldDirty, staleTime, staleTime)

    const result = await sweepWorktrees({ repos: [repo], olderThanDays: 7 })

    const report = result.repos[0]!
    expect(decisionFor(report, young).reason).toBe("unmerged")
    expect(decisionFor(report, old).decision).toBe("SWEEP")
    expect(decisionFor(report, oldDirty).reason).toBe("dirty")
  })

  test("olderThanDays 0 never sweeps unmerged worktrees regardless of age", async () => {
    const { base, repo } = await createFixture("wt-sweep-age0-")
    const old = path.join(base, "wt-old")
    await addUnmergedWorktree(repo, "old-branch", old)
    const staleTime = new Date(Date.now() - 30 * DAY_MS)
    await fs.utimes(old, staleTime, staleTime)

    const result = await sweepWorktrees({ repos: [repo] })
    expect(decisionFor(result.repos[0]!, old).reason).toBe("unmerged")
  })
})

describe("sweepWorktrees --apply", () => {
  test("removes sweep candidates with git worktree remove and prunes stale metadata", async () => {
    const { base, repo } = await createFixture("wt-sweep-apply-")
    const merged = path.join(base, "wt-merged")
    const missing = path.join(base, "wt-missing")
    const kept = path.join(base, "wt-kept")

    await addMergedWorktree(repo, "merged-branch", merged)
    await addMergedWorktree(repo, "missing-branch", missing)
    await addUnmergedWorktree(repo, "unmerged-branch", kept)
    await fs.rm(missing, { recursive: true, force: true })

    const result = await sweepWorktrees({ repos: [repo], apply: true })

    expect(result.apply).toBe(true)
    const report = result.repos[0]!
    expect(report.removed).toEqual([merged])
    expect(report.failed).toEqual([])

    await expect(fs.stat(merged)).rejects.toThrow()
    expect(await fs.stat(kept)).toBeTruthy()
    const porcelain = git(repo, ["worktree", "list", "--porcelain"])
    expect(porcelain).not.toContain(toPosix(missing))
    expect(porcelain).not.toContain(toPosix(merged))
    expect(porcelain).toContain(toPosix(kept))
  })

  test("leaves locked and dirty worktrees in place even under --apply", async () => {
    const { base, repo } = await createFixture("wt-sweep-apply2-")
    const locked = path.join(base, "wt-locked")
    const dirty = path.join(base, "wt-dirty")

    await addMergedWorktree(repo, "locked-branch", locked)
    git(repo, ["worktree", "lock", locked])
    await addMergedWorktree(repo, "dirty-branch", dirty)
    await fs.writeFile(path.join(dirty, "scratch.txt"), "local change\n")

    const result = await sweepWorktrees({ repos: [repo], apply: true })
    const report = result.repos[0]!

    expect(report.removed).toEqual([])
    expect(await fs.stat(locked)).toBeTruthy()
    expect(await fs.stat(dirty)).toBeTruthy()
    expect(result.sweepCount).toBe(0)
  })
})

describe("worktreeSweep output", () => {
  test("prints one machine-parseable line per tree then a summary, and exits 0", async () => {
    const { base, repo } = await createFixture("wt-sweep-output-")
    const merged = path.join(base, "wt-merged")
    const unmerged = path.join(base, "wt-unmerged")
    await addMergedWorktree(repo, "merged-branch", merged)
    await addUnmergedWorktree(repo, "unmerged-branch", unmerged)

    const chunks: string[] = []
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write
    let exitCode: number
    try {
      exitCode = await worktreeSweep({ repos: [repo] })
    } finally {
      process.stdout.write = originalWrite
    }

    expect(exitCode).toBe(0)
    const lines = chunks.join("").trim().split("\n")
    expect(lines[0]).toBe(`REPO ${repo} default=main`)
    expect(lines).toContain(`SWEEP ${merged} merged-branch`)
    expect(lines).toContain(`KEEP(unmerged) ${unmerged} unmerged-branch`)
    const summary = lines[lines.length - 1]!
    expect(summary).toBe(
      "SUMMARY mode=dry-run repos=1 sweep=1 keep=1 prune=0 removed=0 failed=0",
    )
  })

  test("returns exit code 1 and a stderr message for a non-repository path", async () => {
    const base = await newTmpDir("wt-sweep-bad-")

    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: unknown) => {
      originalWrite(String(chunk))
      return true
    }) as typeof process.stderr.write
    let exitCode: number
    try {
      exitCode = await worktreeSweep({ repos: [path.join(base, "not-a-repo")] })
    } finally {
      process.stderr.write = originalWrite
    }

    expect(exitCode).toBe(1)
  })
})

describe("format helpers", () => {
  test("formatClassification and formatSummary stay machine-parseable", () => {
    expect(
      formatClassification({ path: "/tmp/w", ref: "feature", decision: "KEEP", reason: "locked" }),
    ).toBe("KEEP(locked) /tmp/w feature")
    expect(formatClassification({ path: "/tmp/w", ref: "feature", decision: "SWEEP" })).toBe(
      "SWEEP /tmp/w feature",
    )
    expect(formatClassification({ path: "/tmp/w", ref: "", decision: "PRUNE" })).toBe("PRUNE /tmp/w")
  })

  test("formatSummary reports apply counts", () => {
    const summary = formatSummary({
      apply: true,
      olderThanDays: 7,
      repos: [],
      sweepCount: 2,
      keepCount: 1,
      pruneCount: 1,
    })
    expect(summary).toBe("SUMMARY mode=apply repos=0 sweep=2 keep=1 prune=1 removed=0 failed=0")
  })
})
