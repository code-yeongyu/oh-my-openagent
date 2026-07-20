import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { shouldExcludeCodegraphProject } from "./codegraph/workspace"

function tempDir(name: string): string {
  return join(tmpdir(), `omo-${name}-${crypto.randomUUID()}`)
}

describe("CodeGraph project exclusion policy", () => {
  it("excludes default tmp roots and OMO state directories from CodeGraph projects", () => {
    // given
    const tmpWorkspace = process.platform === "win32" ? null : mkdtempSync(join("/tmp", "omo-codegraph-excluded-"))

    try {
      // then
      if (tmpWorkspace !== null) {
        expect(shouldExcludeCodegraphProject(tmpWorkspace, { platform: "linux", tmpdir: "/tmp/omo-current-temp" })).toEqual({
          excluded: true,
          matchedRoot: "/tmp",
          reason: "tmp-root",
        })
      }
      expect(
        shouldExcludeCodegraphProject("/private/tmp/omo-codegraph-scratch/repo", {
          platform: "linux",
          tmpdir: "/tmp/omo-current-temp",
        }),
      ).toMatchObject({ excluded: true, reason: "tmp-root" })
      expect(
        shouldExcludeCodegraphProject("/var/folders/ab/xyz/T/repo", {
          platform: "darwin",
          tmpdir: "/var/folders/ab/xyz/T",
        }),
      ).toEqual({
        excluded: true,
        matchedRoot: "/var/folders/ab/xyz/T",
        reason: "tmp-root",
      })
      expect(
        shouldExcludeCodegraphProject("C:\\Users\\x\\AppData\\Local\\Temp\\Repo", {
          platform: "win32",
          tmpdir: "C:\\Users\\x\\AppData\\Local\\Temp",
        }),
      ).toEqual({
        excluded: true,
        matchedRoot: "C:\\Users\\x\\AppData\\Local\\Temp",
        reason: "tmp-root",
      })
      expect(
        shouldExcludeCodegraphProject("/Users/alice/repo", { platform: "darwin", tmpdir: "/var/folders/ab/xyz/T" }),
      ).toEqual({ excluded: false })
      expect(shouldExcludeCodegraphProject("/Users/alice/repo/.omo/ulw-research/run/clones/repo")).toEqual({
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
    const options = {
      excludedRoots: ["~/research-cache"],
      homeDir,
      platform: "win32" as const,
      tmpdir: "C:\\Users\\x\\AppData\\Local\\Temp",
    }

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
    const options = {
      excludedRoots: ["research-cache"],
      homeDir,
      platform: "win32" as const,
      tmpdir: "C:\\Users\\x\\AppData\\Local\\Temp",
    }

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
