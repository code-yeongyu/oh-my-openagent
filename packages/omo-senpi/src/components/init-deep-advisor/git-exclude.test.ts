/// <reference types="bun-types" />

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import {
  cleanupTempDirs,
  initRepo,
  makeTempDir,
} from "./fixtures.test-support"
import {
  addLocalExcludePaths,
  isExcluded,
  removeLocalExcludePaths,
} from "./git-exclude"

afterEach(() => {
  cleanupTempDirs()
})

function gitInfoExclude(root: string): string {
  return readFileSync(join(root, ".git", "info", "exclude"), "utf8")
}

describe("addLocalExcludePaths", () => {
  test("#given an absent exclude file #when adding paths #then the file is created with those paths", () => {
    // given
    const root = initRepo("omo-git-exclude-")
    const excludePath = join(root, ".git", "info", "exclude")

    // when
    addLocalExcludePaths(root, ["AGENTS.md", ".omo/init-deep.json"])

    // then
    const content = readFileSync(excludePath, "utf8")
    expect(content.split("\n")).toContain("AGENTS.md")
    expect(content.split("\n")).toContain(".omo/init-deep.json")
  })

  test("#given paths already present #when adding the same paths again #then no duplicate lines appear", () => {
    // given
    const root = initRepo("omo-git-exclude-")
    addLocalExcludePaths(root, ["AGENTS.md", ".omo/init-deep.json"])

    // when
    addLocalExcludePaths(root, ["AGENTS.md", ".omo/init-deep.json"])

    // then
    const lines = gitInfoExclude(root).split("\n")
    expect(lines.filter((line) => line === "AGENTS.md")).toHaveLength(1)
    expect(lines.filter((line) => line === ".omo/init-deep.json")).toHaveLength(1)
  })

  test("#given user-written lines in the exclude file #when adding managed paths #then user lines are preserved", () => {
    // given
    const root = initRepo("omo-git-exclude-")
    const excludePath = join(root, ".git", "info", "exclude")
    writeFileSync(excludePath, "user-file.txt\n.env.local\n")

    // when
    addLocalExcludePaths(root, ["AGENTS.md"])

    // then
    const lines = gitInfoExclude(root).split("\n")
    expect(lines).toContain("user-file.txt")
    expect(lines).toContain(".env.local")
    expect(lines).toContain("AGENTS.md")
  })
})

describe("removeLocalExcludePaths", () => {
  test("#given managed and user lines #when removing managed paths #then only named paths are removed", () => {
    // given
    const root = initRepo("omo-git-exclude-")
    const excludePath = join(root, ".git", "info", "exclude")
    writeFileSync(excludePath, [
      "user-file.txt",
      "AGENTS.md",
      ".omo/init-deep.json",
      ".env.local",
    ].join("\n"))

    // when
    removeLocalExcludePaths(root, ["AGENTS.md", ".omo/init-deep.json"])

    // then
    const lines = gitInfoExclude(root).split("\n")
    expect(lines).not.toContain("AGENTS.md")
    expect(lines).not.toContain(".omo/init-deep.json")
    expect(lines).toContain("user-file.txt")
    expect(lines).toContain(".env.local")
  })

  test("#given an absent exclude file #when removing paths #then no-op without throwing", () => {
    // given
    const root = initRepo("omo-git-exclude-")

    // when / then
    expect(() => removeLocalExcludePaths(root, ["AGENTS.md"])).not.toThrow()
  })
})

describe("isExcluded", () => {
  test("#given a path in the exclude file #when checking #then it returns true", () => {
    // given
    const root = initRepo("omo-git-exclude-")
    addLocalExcludePaths(root, ["AGENTS.md"])

    // when / then
    expect(isExcluded(root, "AGENTS.md")).toBe(true)
  })

  test("#given a path not in the exclude file #when checking #then it returns false", () => {
    // given
    const root = initRepo("omo-git-exclude-")
    addLocalExcludePaths(root, ["AGENTS.md"])

    // when / then
    expect(isExcluded(root, "not-excluded.txt")).toBe(false)
  })

  test("#given an absent exclude file #when checking #then it returns false", () => {
    // given
    const root = initRepo("omo-git-exclude-")

    // when / then
    expect(isExcluded(root, "AGENTS.md")).toBe(false)
  })
})

describe("non-git directory", () => {
  test("#given a plain directory #when adding paths #then no-op without throwing", () => {
    // given
    const dir = makeTempDir("omo-git-exclude-nongit-")

    // when / then
    expect(() => addLocalExcludePaths(dir, ["AGENTS.md"])).not.toThrow()
  })

  test("#given a plain directory #when removing paths #then no-op without throwing", () => {
    // given
    const dir = makeTempDir("omo-git-exclude-nongit-")

    // when / then
    expect(() => removeLocalExcludePaths(dir, ["AGENTS.md"])).not.toThrow()
  })

  test("#given a plain directory #when checking exclusion #then it returns false", () => {
    // given
    const dir = makeTempDir("omo-git-exclude-nongit-")

    // when / then
    expect(isExcluded(dir, "AGENTS.md")).toBe(false)
  })
})
