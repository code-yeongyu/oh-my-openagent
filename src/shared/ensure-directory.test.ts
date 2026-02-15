import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ensureDirectory } from "./ensure-directory"

describe("ensureDirectory", () => {
  let testDir: string

  beforeEach(() => {
    //#given a temporary test directory
    testDir = join(tmpdir(), `ensure-directory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  })

  afterEach(() => {
    //#cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("creates a non-existent directory", () => {
    //#given a non-existent directory path
    const targetDir = join(testDir, "new-dir")
    expect(existsSync(targetDir)).toBe(false)

    //#when ensureDirectory is called
    ensureDirectory(targetDir)

    //#then the directory should exist
    expect(existsSync(targetDir)).toBe(true)
  })

  test("creates deeply nested non-existent directories", () => {
    //#given a deeply nested non-existent path
    const deepPath = join(testDir, "level1", "level2", "level3", "level4")
    expect(existsSync(deepPath)).toBe(false)

    //#when ensureDirectory is called
    ensureDirectory(deepPath)

    //#then all intermediate directories should be created
    expect(existsSync(join(testDir, "level1"))).toBe(true)
    expect(existsSync(join(testDir, "level1", "level2"))).toBe(true)
    expect(existsSync(join(testDir, "level1", "level2", "level3"))).toBe(true)
    expect(existsSync(deepPath)).toBe(true)
  })

  test("does not throw when directory already exists", () => {
    //#given an already existing directory
    const existingDir = join(testDir, "existing")
    mkdirSync(existingDir, { recursive: true })
    expect(existsSync(existingDir)).toBe(true)

    //#when ensureDirectory is called on the existing directory
    //#then it should not throw (idempotent)
    expect(() => ensureDirectory(existingDir)).not.toThrow()
    expect(existsSync(existingDir)).toBe(true)
  })

  test("is safe to call multiple times on the same path", () => {
    //#given a path that was just created
    const targetDir = join(testDir, "multi-call")
    ensureDirectory(targetDir)
    expect(existsSync(targetDir)).toBe(true)

    //#when calling ensureDirectory again on the same path
    //#then it should not throw (idempotent)
    expect(() => ensureDirectory(targetDir)).not.toThrow()
    expect(() => ensureDirectory(targetDir)).not.toThrow()
    expect(() => ensureDirectory(targetDir)).not.toThrow()
    expect(existsSync(targetDir)).toBe(true)
  })

  test("handles root-level directory creation", () => {
    //#given a single-level directory path
    const singleLevel = join(testDir, "single")
    expect(existsSync(singleLevel)).toBe(false)

    //#when ensureDirectory is called
    ensureDirectory(singleLevel)

    //#then the directory should exist
    expect(existsSync(singleLevel)).toBe(true)
  })
})
