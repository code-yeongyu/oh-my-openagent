import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

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
  it("writes contents when target file does not exist", () => {
    // given
    const tempDir = createTempPath("omo-codex-atomic-new")
    const targetFilePath = join(tempDir, "state.json")

    // when
    writeFileAtomically(targetFilePath, "first-content")

    // then
    expect(readFileSync(targetFilePath, "utf-8")).toBe("first-content")
  })

  it("replaces contents when target file already exists", () => {
    // given
    const tempDir = createTempPath("omo-codex-atomic-replace")
    const targetFilePath = join(tempDir, "state.json")
    writeFileSync(targetFilePath, "old-content", "utf-8")

    // when
    writeFileAtomically(targetFilePath, "new-content")

    // then
    expect(readFileSync(targetFilePath, "utf-8")).toBe("new-content")
  })

  it("throws when parent directory does not exist", () => {
    // given
    const tempDir = createTempPath("omo-codex-atomic-missing-parent")
    const targetFilePath = join(tempDir, "missing-parent", "state.json")

    // when
    const writeWithMissingParent = (): void => {
      writeFileAtomically(targetFilePath, "content")
    }

    // then
    expect(writeWithMissingParent).toThrow()
  })

  it("produces last-write-wins result for sequential writes", () => {
    // given
    const tempDir = createTempPath("omo-codex-atomic-sequential")
    const targetFilePath = join(tempDir, "state.json")

    // when
    writeFileAtomically(targetFilePath, "first")
    writeFileAtomically(targetFilePath, "second")
    writeFileAtomically(targetFilePath, "third")

    // then
    expect(readFileSync(targetFilePath, "utf-8")).toBe("third")
  })
})
