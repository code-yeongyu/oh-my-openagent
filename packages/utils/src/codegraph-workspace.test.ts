import { describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  ensureCodegraphGitignored,
  prepareCodegraphWorkspace,
  pruneDeadCodegraphProjectStores,
  pruneCodegraphStore,
  sanitizeBase,
} from "./codegraph/workspace"

function tempDir(name: string): string {
  return join(tmpdir(), `omo-${name}-${crypto.randomUUID()}`)
}

describe("prepareCodegraphWorkspace", () => {
  it("preserves an existing real .codegraph directory in project", () => {
    // given
    const workspace = tempDir("codegraph-existing")
    mkdirSync(join(workspace, ".codegraph"), { recursive: true })
    writeFileSync(join(workspace, ".codegraph", "keep.txt"), "keep")

    // when
    const result = prepareCodegraphWorkspace(workspace, { homeDir: tempDir("home") })

    // then
    expect(result.mode).toBe("in-project")
    expect(result.linked).toBe(false)
    expect(readFileSync(join(workspace, ".codegraph", "keep.txt"), "utf8")).toBe("keep")

    rmSync(workspace, { force: true, recursive: true })
  })

  it("creates a global project store and symlinks absent .codegraph on the same filesystem", () => {
    // given
    const workspace = tempDir("codegraph-link")
    const homeDir = tempDir("home")
    mkdirSync(workspace, { recursive: true })

    // when
    const result = prepareCodegraphWorkspace(workspace, { homeDir })

    // then
    expect(result.mode).toBe("global-linked")
    expect(result.linked).toBe(true)
    expect(readlinkSync(join(workspace, ".codegraph"))).toContain(join(homeDir, ".omo", "codegraph", "projects"))
    expect(JSON.parse(readFileSync(join(result.dataDir, "source.json"), "utf8"))).toEqual({
      sourceDir: realpathSync(workspace),
      version: 1,
    })

    rmSync(workspace, { force: true, recursive: true })
    rmSync(homeDir, { force: true, recursive: true })
  })

  it("falls back in place when symlink creation fails", () => {
    // given
    const workspace = tempDir("codegraph-symlink-fails")
    mkdirSync(workspace, { recursive: true })

    // when
    const result = prepareCodegraphWorkspace(workspace, {
      homeDir: tempDir("home"),
      symlink: () => {
        throw new Error("blocked")
      },
    })

    // then
    expect(result.mode).toBe("in-place-fallback")
    expect(result.linked).toBe(false)

    rmSync(workspace, { force: true, recursive: true })
  })

  it("uses fallback mode for a wrong-target symlink without throwing", () => {
    // given
    const workspace = tempDir("codegraph-wrong-link")
    const target = tempDir("wrong-target")
    mkdirSync(workspace, { recursive: true })
    mkdirSync(target, { recursive: true })
    symlinkSync(target, join(workspace, ".codegraph"), "dir")

    // when
    const result = prepareCodegraphWorkspace(workspace, { homeDir: tempDir("home") })

    // then
    expect(result.mode).toBe("in-place-fallback")
    expect(result.linked).toBe(false)

    rmSync(workspace, { force: true, recursive: true })
    rmSync(target, { force: true, recursive: true })
  })
})

describe("CodeGraph workspace helpers", () => {
  it("sanitizes project base names for store directory keys", () => {
    // given
    const value = "my repo:../with spaces"

    // when
    const result = sanitizeBase(value)

    // then
    expect(result).toBe("my-repo-..-with-spaces")
  })

  it("adds a single .codegraph exclusion for a valid Git worktree", () => {
    // given
    const workspace = tempDir("codegraph-gitignore")
    mkdirSync(workspace, { recursive: true })
    execFileSync("git", ["init", workspace], { stdio: "ignore" })

    // when
    const firstResult = ensureCodegraphGitignored(workspace)
    const secondResult = ensureCodegraphGitignored(workspace)

    // then
    const exclusions = readFileSync(join(workspace, ".git", "info", "exclude"), "utf8").split(/\r?\n/)
    expect(firstResult).toBe(true)
    expect(secondResult).toBe(true)
    expect(exclusions.filter((exclusion) => exclusion === ".codegraph")).toHaveLength(1)
    expect(existsSync(join(workspace, ".gitignore"))).toBe(false)

    rmSync(workspace, { force: true, recursive: true })
  })

  it("does not mutate a workspace with an empty .git marker", () => {
    // given
    const workspace = tempDir("codegraph-empty-git")
    mkdirSync(join(workspace, ".git"), { recursive: true })

    // when
    const result = ensureCodegraphGitignored(workspace)

    // then
    expect(result).toBe(false)
    expect(existsSync(join(workspace, ".git", "info", "exclude"))).toBe(false)

    rmSync(workspace, { force: true, recursive: true })
  })
  it("does not mutate an invalid nested .git marker or its parent repository", () => {
    // given
    const parent = tempDir("codegraph-parent-git")
    const workspace = join(parent, "nested")
    mkdirSync(workspace, { recursive: true })
    execFileSync("git", ["init", parent], { stdio: "ignore" })
    mkdirSync(join(workspace, ".git"), { recursive: true })
    const parentExcludePath = join(parent, ".git", "info", "exclude")
    const parentExclusionsBefore = readFileSync(parentExcludePath, "utf8")

    // when
    const result = ensureCodegraphGitignored(workspace)

    // then
    expect(result).toBe(false)
    expect(existsSync(join(workspace, ".git", "info", "exclude"))).toBe(false)
    expect(readFileSync(parentExcludePath, "utf8")).toBe(parentExclusionsBefore)

    rmSync(parent, { force: true, recursive: true })
  })

  it("does not follow a nested gitdir marker into its parent repository", () => {
    // given
    const parent = tempDir("codegraph-parent-gitdir")
    const workspace = join(parent, "nested")
    mkdirSync(workspace, { recursive: true })
    execFileSync("git", ["init", parent], { stdio: "ignore" })
    writeFileSync(join(workspace, ".git"), "gitdir: ../.git\n")
    const parentExcludePath = join(parent, ".git", "info", "exclude")
    const parentExclusionsBefore = readFileSync(parentExcludePath, "utf8")

    // when
    const result = ensureCodegraphGitignored(workspace)

    // then
    expect(result).toBe(false)
    expect(readFileSync(parentExcludePath, "utf8")).toBe(parentExclusionsBefore)
    expect(readFileSync(join(workspace, ".git"), "utf8")).toBe("gitdir: ../.git\n")

    rmSync(parent, { force: true, recursive: true })
  })

  it("adds a single exclusion through a valid linked-worktree marker", () => {
    // given
    const root = tempDir("codegraph-linked-worktree")
    const main = join(root, "main")
    const linked = join(root, "linked")
    execFileSync("git", ["init", main], { stdio: "ignore" })
    execFileSync(
      "git",
      [
        "-C", main,
        "-c", "user.name=OMO Test",
        "-c", "user.email=omo@example.invalid",
        "commit", "--allow-empty", "-m", "init",
      ],
      { stdio: "ignore" },
    )
    execFileSync("git", ["-C", main, "worktree", "add", "--detach", linked], { stdio: "ignore" })
    const markerBefore = readFileSync(join(linked, ".git"), "utf8")
    const excludePath = resolve(
      linked,
      execFileSync("git", ["-C", linked, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" }).trim(),
    )

    // when
    const firstResult = ensureCodegraphGitignored(linked)
    const secondResult = ensureCodegraphGitignored(linked)

    // then
    const exclusions = readFileSync(excludePath, "utf8").split(/\r?\n/)
    expect(firstResult).toBe(true)
    expect(secondResult).toBe(true)
    expect(readFileSync(join(linked, ".git"), "utf8")).toBe(markerBefore)
    expect(exclusions.filter((exclusion) => exclusion === ".codegraph")).toHaveLength(1)

    rmSync(root, { force: true, recursive: true })
  })

  it("does not synthesize git info exclude for non-git workspaces", () => {
    // given
    const workspace = tempDir("codegraph-non-git")
    mkdirSync(workspace, { recursive: true })

    // when
    const result = ensureCodegraphGitignored(workspace)

    // then
    expect(result).toBe(false)
    expect(existsSync(join(workspace, ".git"))).toBe(false)

    rmSync(workspace, { force: true, recursive: true })
  })

  it("prunes least-recently-used project stores over the size cap", () => {
    // given
    const homeDir = tempDir("home")
    const projects = join(homeDir, ".omo", "codegraph", "projects")
    const oldProject = join(projects, "old")
    const newProject = join(projects, "new")
    mkdirSync(oldProject, { recursive: true })
    mkdirSync(newProject, { recursive: true })
    writeFileSync(join(oldProject, "blob"), "x".repeat(20))
    writeFileSync(join(newProject, "blob"), "x".repeat(20))

    // when
    const result = pruneCodegraphStore({ homeDir, maxAgeDays: 999, maxBytes: 25 })

    // then
    expect(result.removed.length).toBe(1)
    expect(result.remainingBytes).toBeLessThanOrEqual(25)

    rmSync(homeDir, { force: true, recursive: true })
  })

  it("prunes project stores whose recorded source directory no longer exists", () => {
    // given
    const homeDir = tempDir("home")
    const liveSource = tempDir("live-source")
    const deadSource = tempDir("dead-source")
    mkdirSync(liveSource, { recursive: true })
    mkdirSync(deadSource, { recursive: true })
    const liveProject = prepareCodegraphWorkspace(liveSource, { homeDir })
    const deadProject = prepareCodegraphWorkspace(deadSource, { homeDir })
    writeFileSync(join(liveProject.dataDir, "blob"), "live")
    writeFileSync(join(deadProject.dataDir, "blob"), "dead")
    rmSync(deadSource, { force: true, recursive: true })

    // when
    const options = { homeDir, maxAgeDays: 999, maxBytes: 100_000, pruneMissingSources: true }
    const result = pruneCodegraphStore(options)

    // then
    expect(result.removed).toContain(deadProject.dataDir)
    expect(result.removed).not.toContain(liveProject.dataDir)
    expect(existsSync(deadProject.dataDir)).toBe(false)
    expect(existsSync(liveProject.dataDir)).toBe(true)

    rmSync(liveSource, { force: true, recursive: true })
    rmSync(homeDir, { force: true, recursive: true })
  })

  it("prunes dead project stores without recursively sizing cache contents", () => {
    if (process.platform === "win32") return

    // given
    const homeDir = tempDir("home")
    const liveSource = tempDir("live-source")
    const deadSource = tempDir("dead-source")
    mkdirSync(liveSource, { recursive: true })
    mkdirSync(deadSource, { recursive: true })
    const liveProject = prepareCodegraphWorkspace(liveSource, { homeDir })
    const deadProject = prepareCodegraphWorkspace(deadSource, { homeDir })
    const unreadableCacheDir = join(liveProject.dataDir, "huge-cache")
    mkdirSync(unreadableCacheDir, { recursive: true })
    chmodSync(unreadableCacheDir, 0)
    rmSync(deadSource, { force: true, recursive: true })

    try {
      // when
      const result = pruneDeadCodegraphProjectStores({ homeDir })

      // then
      expect(result.removed).toContain(deadProject.dataDir)
      expect(result.removed).not.toContain(liveProject.dataDir)
      expect(existsSync(deadProject.dataDir)).toBe(false)
      expect(existsSync(liveProject.dataDir)).toBe(true)
    } finally {
      if (existsSync(unreadableCacheDir)) chmodSync(unreadableCacheDir, 0o700)
      rmSync(liveSource, { force: true, recursive: true })
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("ignores malformed source metadata while pruning valid dead project stores", () => {
    // given
    const homeDir = tempDir("home")
    const liveSource = tempDir("live-source")
    const deadSource = tempDir("dead-source")
    mkdirSync(liveSource, { recursive: true })
    mkdirSync(deadSource, { recursive: true })
    const malformedProject = prepareCodegraphWorkspace(liveSource, { homeDir })
    const deadProject = prepareCodegraphWorkspace(deadSource, { homeDir })
    writeFileSync(join(malformedProject.dataDir, "source.json"), "{")
    rmSync(deadSource, { force: true, recursive: true })

    // when
    const result = pruneDeadCodegraphProjectStores({ homeDir })

    // then
    expect(result.removed).toContain(deadProject.dataDir)
    expect(result.removed).not.toContain(malformedProject.dataDir)
    expect(existsSync(deadProject.dataDir)).toBe(false)
    expect(existsSync(malformedProject.dataDir)).toBe(true)

    rmSync(liveSource, { force: true, recursive: true })
    rmSync(homeDir, { force: true, recursive: true })
  })

})
