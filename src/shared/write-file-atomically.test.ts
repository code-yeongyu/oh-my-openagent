import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { writeFileAtomically } from "./write-file-atomically"

const testDir = join(tmpdir(), "write-file-atomically-test-" + Date.now())

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe("writeFileAtomically", () => {
  it("writes content to a new file", () => {
    // given
    const filePath = join(testDir, "new-file.txt")
    const content = "hello world"

    // when
    writeFileAtomically(filePath, content)

    // then
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath, "utf-8")).toBe(content)
  })

  it("#given target file exists #when writeFileAtomically called #then overwrites successfully", () => {
    // given
    const filePath = join(testDir, "existing-file.txt")
    const originalContent = "original content"
    const newContent = "new content"
    writeFileSync(filePath, originalContent, "utf-8")

    // when
    writeFileAtomically(filePath, newContent)

    // then
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath, "utf-8")).toBe(newContent)
    expect(existsSync(`${filePath}.tmp`)).toBe(false)
  })

  it("#given parent directory does not exist #when writeFileAtomically called #then throws", () => {
    // given
    const filePath = join(testDir, "nonexistent", "deep", "file.txt")

    // when/then
    expect(() => writeFileAtomically(filePath, "content")).toThrow()
  })
})
