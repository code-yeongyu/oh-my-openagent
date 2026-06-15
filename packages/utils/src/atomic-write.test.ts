import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeFileAtomically } from "./atomic-write"

const tempPaths: string[] = []

function createTempPath(prefix: string): string {
  const tempPath = mkdtempSync(join(tmpdir(), `${prefix}-`))
  tempPaths.push(tempPath)
  return tempPath
}

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    rmSync(tempPath, { recursive: true, force: true })
  }
})

describe("writeFileAtomically", () => {
  it("#given target file does not exist #when writing #then writes content", () => {
    // given
    const tempDir = createTempPath("utils-atomic-new")
    const targetFilePath = join(tempDir, "state.json")

    // when
    writeFileAtomically(targetFilePath, "first-content")

    // then
    expect(readFileSync(targetFilePath, "utf-8")).toBe("first-content")
  })

  it("#given target file exists #when writing #then replaces content and removes temp file", () => {
    // given
    const tempDir = createTempPath("utils-atomic-replace")
    const targetFilePath = join(tempDir, "state.json")
    writeFileSync(targetFilePath, "old-content", "utf-8")

    // when
    writeFileAtomically(targetFilePath, "new-content")

    // then
    expect(readFileSync(targetFilePath, "utf-8")).toBe("new-content")
  })

  it("#given parent directory is missing #when writing #then throws", () => {
    // given
    const tempDir = createTempPath("utils-atomic-missing-parent")
    const targetFilePath = join(tempDir, "missing-parent", "state.json")

    // when
    const writeWithMissingParent = (): void => {
      writeFileAtomically(targetFilePath, "content")
    }

    // then
    expect(writeWithMissingParent).toThrow()
  })

  it("#given sequential writes #when writing #then last write wins", () => {
    // given
    const tempDir = createTempPath("utils-atomic-sequential")
    const targetFilePath = join(tempDir, "state.json")

    // when
    writeFileAtomically(targetFilePath, "first")
    writeFileAtomically(targetFilePath, "second")
    writeFileAtomically(targetFilePath, "third")

    // then
    expect(readFileSync(targetFilePath, "utf-8")).toBe("third")
  })
})
