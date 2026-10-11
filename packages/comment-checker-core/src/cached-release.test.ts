import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { COMMENT_CHECKER_VERSION_MARKER, isCachedCommentCheckerCurrent, recordCachedCommentCheckerRelease } from "./cached-release"
import { COMMENT_CHECKER_RELEASE_VERSION } from "./release"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("cached comment-checker release marker (#8850)", () => {
  test("#given a cache slot without a marker #when checked #then it is not current", () => {
    // given
    const cacheDir = mkdtempSync(join(tmpdir(), "cc-cache-"))
    roots.push(cacheDir)

    // when
    const current = isCachedCommentCheckerCurrent(cacheDir)

    // then
    expect(current).toBe(false)
  })

  test("#given a recorded release #when checked #then it is current and the marker holds the pinned version", () => {
    // given
    const cacheDir = mkdtempSync(join(tmpdir(), "cc-cache-"))
    roots.push(cacheDir)
    recordCachedCommentCheckerRelease(cacheDir)

    // when
    const current = isCachedCommentCheckerCurrent(cacheDir)

    // then
    expect(current).toBe(true)
    expect(readFileSync(join(cacheDir, COMMENT_CHECKER_VERSION_MARKER), "utf-8")).toBe(`${COMMENT_CHECKER_RELEASE_VERSION}\n`)
  })

  test("#given a marker from another release #when checked #then it is not current", () => {
    // given
    const readFile = () => "0.6.1\n"

    // when
    const current = isCachedCommentCheckerCurrent("/unused", readFile)

    // then
    expect(current).toBe(false)
  })
})
