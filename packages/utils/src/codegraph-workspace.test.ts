import { describe, expect, it } from "bun:test"
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
import { join } from "node:path"

import {
  ensureCodegraphGitignored,
  prepareCodegraphWorkspace,
  pruneDeadCodegraphProjectStores,
  pruneCodegraphStore,
  sanitizeBase,
  shouldExcludeCodegraphProject,
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

  it("adds .codegraph to git info exclude without touching .gitignore", () => {
    // given
    const workspace = tempDir("codegraph-gitignore")
    mkdirSync(join(workspace, ".git", "info"), { recursive: true })

    // when
    const result = ensureCodegraphGitignored(workspace)

    // then
    expect(result).toBe(true)
    expect(readFileSync(join(workspace, ".git", "info", "exclude"), "utf8")).toContain(".codegraph")

    rmSync(workspace, { force: true, recursive: true })
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

  it("excludes POSIX tmp roots and OMO state directories from CodeGraph projects", () => {
    // given
    const tmpWorkspace = process.platform === "win32" ? null : mkdtempSync(join("/tmp", "omo-codegraph-excluded-"))

    try {
      // then
      if (tmpWorkspace !== null) {
        expect(shouldExcludeCodegraphProject(tmpWorkspace, { platform: "linux" })).toMatchObject({
          excluded: true,
          reason: "tmp-root",
        })
      }
      expect(shouldExcludeCodegraphProject("/private/tmp/omo-codegraph-scratch/repo", { platform: "linux" })).toMatchObject({
        excluded: true,
        reason: "tmp-root",
      })
      expect(shouldExcludeCodegraphProject("/Users/alice/repo/.omo/ultraresearch/run/clones/repo")).toEqual({
        excluded: true,
        matchedRoot: ".omo",
        reason: "omo-state",
      })
    } finally {
      if (tmpWorkspace !== null) rmSync(tmpWorkspace, { force: true, recursive: true })
    }
  })

  it("applies custom excluded roots without excluding sibling project roots", () => {
    // given
    const homeDir = tempDir("home")
    const excludedRoot = join(homeDir, "research-cache")
    const excludedWorkspace = join(excludedRoot, "repo")
    const allowedWorkspace = join(homeDir, "research-cache-sibling", "repo")
    const options = { excludedRoots: ["~/research-cache"], homeDir, platform: "win32" as const }

    // then
    expect(shouldExcludeCodegraphProject(excludedWorkspace, options)).toEqual({
      excluded: true,
      matchedRoot: "~/research-cache",
      reason: "custom-root",
    })
    expect(shouldExcludeCodegraphProject(allowedWorkspace, options)).toEqual({
      excluded: false,
    })
  })

  it("resolves relative custom excluded roots from the configured home directory", () => {
    // given
    const homeDir = tempDir("home")
    const excludedWorkspace = join(homeDir, "research-cache", "repo")
    const allowedWorkspace = join(homeDir, "other-cache", "repo")
    const options = { excludedRoots: ["research-cache"], homeDir, platform: "win32" as const }

    // then
    expect(shouldExcludeCodegraphProject(excludedWorkspace, options)).toEqual({
      excluded: true,
      matchedRoot: "research-cache",
      reason: "custom-root",
    })
    expect(shouldExcludeCodegraphProject(allowedWorkspace, options)).toEqual({
      excluded: false,
    })
  })
})
