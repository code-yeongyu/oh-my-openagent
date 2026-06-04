/// <reference path="../../../bun-test.d.ts" />

import { beforeEach, describe, expect, it } from "bun:test"
import {
  createContentHash,
  getMatcherCacheStats,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  resetMatcherCache,
  shouldApplyRule,
} from "./matcher"

describe("shouldApplyRule", () => {
  beforeEach(() => {
    resetMatcherCache()
  })

  it("#given repeated glob metadata #when matching many files #then compiles each pattern once", () => {
    // given
    const metadata = { globs: ["src/**/*.ts", "test/**/*.ts"] }
    const projectRoot = "/workspace/project"

    // when
    for (let index = 0; index < 20; index += 1) {
      shouldApplyRule(metadata, `${projectRoot}/src/file-${index}.ts`, projectRoot)
      shouldApplyRule(metadata, `${projectRoot}/test/file-${index}.ts`, projectRoot)
    }

    // then
    expect(getMatcherCacheStats()).toEqual({ entries: 2 })
  })

  it("#given many unique globs #when matching repeatedly #then matcher cache stays bounded", () => {
    // given
    const projectRoot = "/workspace/project"

    // when
    for (let index = 0; index < 300; index += 1) {
      shouldApplyRule({ globs: `src/file-${index}.ts` }, `${projectRoot}/src/file-${index}.ts`, projectRoot)
    }

    // then
    expect(getMatcherCacheStats().entries <= 256).toBe(true)
  })

  it("#given matching glob #when path is under project root #then returns matching reason", () => {
    // given / when
    const result = shouldApplyRule({ globs: "src/**/*.ts" }, "/workspace/project/src/index.ts", "/workspace/project")

    // then
    expect(result).toEqual({ applies: true, reason: "glob: src/**/*.ts" })
  })

  it("#given always apply metadata #when no globs exist #then applies without compiling matchers", () => {
    // given / when
    const result = shouldApplyRule({ alwaysApply: true }, "/workspace/project/src/index.ts", "/workspace/project")

    // then
    expect(result).toEqual({ applies: true, reason: "alwaysApply" })
    expect(getMatcherCacheStats()).toEqual({ entries: 0 })
  })
})

describe("rule duplicate helpers", () => {
  it("#given real path cache #when path exists #then reports duplicate", () => {
    // given
    const cache = new Set(["/workspace/project/AGENTS.md"])

    // when / then
    expect(isDuplicateByRealPath("/workspace/project/AGENTS.md", cache)).toBe(true)
    expect(isDuplicateByRealPath("/workspace/project/src/AGENTS.md", cache)).toBe(false)
  })

  it("#given content #when hashing #then duplicate helper uses truncated hash", () => {
    // given
    const hash = createContentHash("rule-content")
    const cache = new Set([hash])

    // when / then
    expect(hash).toHaveLength(16)
    expect(isDuplicateByContentHash(hash, cache)).toBe(true)
  })
})
