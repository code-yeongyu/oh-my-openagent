import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// Import the function we'll create to replace glob
import { findFileRecursive } from "./downloader"

describe("findFileRecursive", () => {
  let testDir: string

  beforeEach(() => {
    // #given - create temp directory for testing
    testDir = join(tmpdir(), `downloader-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // cleanup
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("should find file in root directory", () => {
    // #given
    const targetFile = join(testDir, "rg.exe")
    writeFileSync(targetFile, "dummy content")

    // #when
    const result = findFileRecursive(testDir, "rg.exe")

    // #then
    expect(result).toBe(targetFile)
  })

  test("should find file in nested directory (ripgrep release structure)", () => {
    // #given - simulate ripgrep release zip structure
    const nestedDir = join(testDir, "ripgrep-14.1.1-x86_64-pc-windows-msvc")
    mkdirSync(nestedDir, { recursive: true })
    const targetFile = join(nestedDir, "rg.exe")
    writeFileSync(targetFile, "dummy content")

    // #when
    const result = findFileRecursive(testDir, "rg.exe")

    // #then
    expect(result).toBe(targetFile)
  })

  test("should find file in deeply nested directory", () => {
    // #given
    const deepDir = join(testDir, "level1", "level2", "level3")
    mkdirSync(deepDir, { recursive: true })
    const targetFile = join(deepDir, "rg")
    writeFileSync(targetFile, "dummy content")

    // #when
    const result = findFileRecursive(testDir, "rg")

    // #then
    expect(result).toBe(targetFile)
  })

  test("should return null when file not found", () => {
    // #given - empty directory

    // #when
    const result = findFileRecursive(testDir, "nonexistent.exe")

    // #then
    expect(result).toBeNull()
  })

  test("should find first match when multiple files exist", () => {
    // #given
    const dir1 = join(testDir, "dir1")
    const dir2 = join(testDir, "dir2")
    mkdirSync(dir1, { recursive: true })
    mkdirSync(dir2, { recursive: true })
    writeFileSync(join(dir1, "rg"), "first")
    writeFileSync(join(dir2, "rg"), "second")

    // #when
    const result = findFileRecursive(testDir, "rg")

    // #then
    expect(result).not.toBeNull()
    expect(result!.endsWith("rg")).toBe(true)
  })

  test("should match exact filename, not partial", () => {
    // #given
    writeFileSync(join(testDir, "rg.exe.bak"), "backup file")
    writeFileSync(join(testDir, "not-rg.exe"), "wrong file")

    // #when
    const result = findFileRecursive(testDir, "rg.exe")

    // #then
    expect(result).toBeNull()
  })
})
