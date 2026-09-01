/// <reference types="bun-types" />

import { mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import {
  cleanupTempDirs,
  makeDirWithSourceFiles,
  makeTempDir,
  sourceFile,
  writeFileAt,
} from "./fixtures.test-support"
import { computeCandidateDirs, computeCoverageRatio, isCovered, shouldProposeInit } from "./coverage"

afterEach(() => {
  cleanupTempDirs()
})

function makeThreeCandidateRepo(): string {
  const root = makeTempDir("omo-coverage-")
  makeDirWithSourceFiles(root, "alpha", 8)
  makeDirWithSourceFiles(root, "beta", 9)
  makeDirWithSourceFiles(root, "gamma", 10)
  return root
}

describe("computeCandidateDirs", () => {
  test("#given three dirs with 8+ source files #when computing candidates #then all three qualify", () => {
    // given
    const root = makeThreeCandidateRepo()

    // when
    const candidates = computeCandidateDirs(root)

    // then
    expect(candidates.map((dir) => dir.path).sort()).toEqual(
      [join(root, "alpha"), join(root, "beta"), join(root, "gamma")].sort(),
    )
  })

  test("#given a dir with few files but 500+ LOC #when computing candidates #then it qualifies by LOC", () => {
    // given
    const root = makeTempDir("omo-coverage-loc-")
    writeFileAt(root, join("big", "huge.ts"), sourceFile(600))

    // when
    const candidates = computeCandidateDirs(root)

    // then
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.path).toBe(join(root, "big"))
    expect(candidates[0]!.files).toBe(1)
    expect(candidates[0]!.loc).toBeGreaterThanOrEqual(500)
  })

  test("#given a tiny repo below both thresholds #when computing candidates #then none qualify", () => {
    // given
    const root = makeTempDir("omo-coverage-tiny-")
    makeDirWithSourceFiles(root, "small", 3)

    // when
    const candidates = computeCandidateDirs(root)

    // then
    expect(candidates).toHaveLength(0)
  })

  test("#given nested dirs sharing a subtree #when computing candidates #then files are counted per directory only", () => {
    // given
    const root = makeTempDir("omo-coverage-nested-")
    makeDirWithSourceFiles(root, "src", 8)
    makeDirWithSourceFiles(root, join("src", "domain"), 8)

    // when
    const candidates = computeCandidateDirs(root)

    // then
    const bySrc = candidates.find((dir) => dir.path === join(root, "src"))
    const byDomain = candidates.find((dir) => dir.path === join(root, "src", "domain"))
    expect(bySrc?.files).toBe(8)
    expect(byDomain?.files).toBe(8)
  })

  test("#given a candidate dir deeper than the max depth #when computing candidates #then it is not returned", () => {
    // given
    const root = makeTempDir("omo-coverage-depth-")
    makeDirWithSourceFiles(root, join("a", "b", "c", "d"), 12)

    // when
    const candidates = computeCandidateDirs(root)

    // then
    expect(candidates.map((dir) => dir.path)).not.toContain(join(root, "a", "b", "c", "d"))
  })

  test("#given excluded directory names #when computing candidates #then they are skipped", () => {
    // given
    const root = makeTempDir("omo-coverage-excluded-")
    makeDirWithSourceFiles(root, "node_modules", 20)
    makeDirWithSourceFiles(root, "dist", 20)

    // when
    const candidates = computeCandidateDirs(root)

    // then
    expect(candidates).toHaveLength(0)
  })

  test("#given a symlinked directory #when computing candidates #then the symlink is skipped", () => {
    // given
    const root = makeTempDir("omo-coverage-symlink-")
    makeDirWithSourceFiles(root, "real", 8)
    mkdirSync(join(root, "holder"), { recursive: true })
    symlinkSync(join(root, "real"), join(root, "holder", "linked"), "dir")

    // when
    const candidates = computeCandidateDirs(root)

    // then
    expect(candidates.map((dir) => dir.path)).toEqual([join(root, "real")])
  })
})

describe("isCovered", () => {
  test("#given a dir with its own AGENTS.md #when checking coverage #then it is covered", () => {
    // given
    const root = makeTempDir("omo-covered-own-")
    makeDirWithSourceFiles(root, "alpha", 8)
    writeFileAt(root, join("alpha", "AGENTS.md"), "# alpha")

    // when
    const result = isCovered(root, join(root, "alpha"))

    // then
    expect(result).toBe(true)
  })

  test("#given an ancestor with AGENTS.md #when checking coverage #then the descendant inherits coverage", () => {
    // given
    const root = makeTempDir("omo-covered-ancestor-")
    makeDirWithSourceFiles(root, join("src", "domain"), 8)
    writeFileAt(root, join("src", "AGENTS.md"), "# src")

    // when
    const result = isCovered(root, join(root, "src", "domain"))

    // then
    expect(result).toBe(true)
  })

  test("#given only a root AGENTS.md #when checking a nested dir #then root counts as an inclusive ancestor", () => {
    // given
    const root = makeTempDir("omo-covered-root-")
    makeDirWithSourceFiles(root, join("src", "domain"), 8)
    writeFileAt(root, "AGENTS.md", "# root")

    // when
    const result = isCovered(root, join(root, "src", "domain"))

    // then
    expect(result).toBe(true)
  })

  test("#given no AGENTS.md anywhere #when checking a nested dir #then it is not covered", () => {
    // given
    const root = makeTempDir("omo-covered-none-")
    makeDirWithSourceFiles(root, join("src", "domain"), 8)

    // when
    const result = isCovered(root, join(root, "src", "domain"))

    // then
    expect(result).toBe(false)
  })
})

describe("computeCoverageRatio and shouldProposeInit", () => {
  test("#given three candidate dirs and zero AGENTS.md #when computing coverage #then missingRatio is 1.0 and init is proposed", () => {
    // given
    const root = makeThreeCandidateRepo()

    // when
    const result = computeCoverageRatio(root)

    // then
    expect(result).not.toBeNull()
    expect(result!.candidateDirs).toBe(3)
    expect(result!.coveredDirs).toBe(0)
    expect(result!.coverage).toBe(0)
    expect(result!.missingRatio).toBe(1)
    expect(shouldProposeInit(result!.missingRatio, false)).toBe(true)
  })

  test("#given three candidate dirs all covered #when computing coverage #then missingRatio is 0.0 and init is not proposed", () => {
    // given
    const root = makeThreeCandidateRepo()
    for (const name of ["alpha", "beta", "gamma"]) {
      writeFileAt(root, join(name, "AGENTS.md"), `# ${name}`)
    }

    // when
    const result = computeCoverageRatio(root)

    // then
    expect(result!.candidateDirs).toBe(3)
    expect(result!.coveredDirs).toBe(3)
    expect(result!.coverage).toBe(1)
    expect(result!.missingRatio).toBe(0)
    expect(shouldProposeInit(result!.missingRatio, false)).toBe(false)
  })

  test("#given zero candidate dirs #when computing coverage #then it returns null and init is not proposed", () => {
    // given
    const root = makeTempDir("omo-coverage-zero-")
    makeDirWithSourceFiles(root, "small", 2)

    // when
    const result = computeCoverageRatio(root)

    // then
    expect(result).toBeNull()
    expect(shouldProposeInit(result?.missingRatio ?? null, false)).toBe(false)
  })

  test("#given full nested coverage without a root AGENTS.md #when deciding #then init is not proposed", () => {
    // given
    const root = makeThreeCandidateRepo()
    for (const name of ["alpha", "beta", "gamma"]) {
      writeFileAt(root, join(name, "AGENTS.md"), `# ${name}`)
    }
    const rootHasAgentsMd = false

    // when
    const result = computeCoverageRatio(root)

    // then
    expect(shouldProposeInit(result?.missingRatio ?? null, rootHasAgentsMd)).toBe(false)
  })

  test("#given half the candidate dirs uncovered #when deciding #then the 0.50 threshold proposes", () => {
    // given
    const root = makeTempDir("omo-coverage-half-")
    makeDirWithSourceFiles(root, "alpha", 8)
    makeDirWithSourceFiles(root, "beta", 8)
    writeFileAt(root, join("alpha", "AGENTS.md"), "# alpha")

    // when
    const result = computeCoverageRatio(root)

    // then
    expect(result!.missingRatio).toBe(0.5)
    expect(shouldProposeInit(result!.missingRatio, false)).toBe(true)
  })

  test("#given a null missingRatio #when deciding #then it never proposes", () => {
    // given
    const missingRatio = null

    // when
    const result = shouldProposeInit(missingRatio, true)

    // then
    expect(result).toBe(false)
  })
})
