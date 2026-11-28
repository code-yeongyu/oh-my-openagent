import { describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

import { shortTempDir, unsettledShortTempDirs } from "./short-tmp"

describe("shortTempDir registration (#15106)", () => {
  test("#given a directory the test removed #when the teardown asks #then nothing is unsettled", () => {
    const dir = shortTempDir("omo-short-tmp-clean-")
    expect(existsSync(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
    expect(unsettledShortTempDirs().filter((leftover) => leftover.path === dir)).toEqual([])
  })

  test("#given a directory the test forgot #when the teardown asks #then it is removed and reported with its owner file", () => {
    const dir = shortTempDir("omo-short-tmp-forgotten-")
    expect(existsSync(dir)).toBe(true)

    const leftovers = unsettledShortTempDirs().filter((leftover) => leftover.path === dir)

    expect(leftovers).toHaveLength(1)
    expect(leftovers[0]?.file).toContain("short-tmp.test")
    expect(existsSync(dir)).toBe(false)
  })

  test("#given a directory outside the OS temp dir #when created #then it does not live under tmpdir (#15106)", () => {
    const dir = shortTempDir("omo-short-tmp-placement-")
    rmSync(dir, { recursive: true, force: true })
    expect(dir.startsWith(tmpdir())).toBe(false)
  })
})
