import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prepareLookAtInput } from "./look-at-input-preparer"

describe("prepareLookAtInput JSON file handling", () => {
  test("#given an existing JSON file #when preparing input #then returns a text part containing the file content", () => {
    //#given
    const dir = mkdtempSync(join(tmpdir(), "look-at-json-ok-"))
    const jsonPath = join(dir, "data.json")
    writeFileSync(jsonPath, '{"hello":"world"}')

    try {
      //#when
      const result = prepareLookAtInput({ file_path: jsonPath, goal: "inspect" })

      //#then
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.inputParts).toHaveLength(1)
      const part = result.value.inputParts[0]
      expect(part?.type).toBe("text")
      if (part?.type !== "text") return
      expect(part.text).toContain("Attached JSON file (data.json)")
      expect(part.text).toContain('{"hello":"world"}')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("#given a missing JSON file #when preparing input #then returns ok:false with a File not found error instead of throwing", () => {
    //#given
    const missingPath = join(tmpdir(), "look-at-json-missing-3f9c2a1b9d.json")

    //#when
    const result = prepareLookAtInput({ file_path: missingPath, goal: "inspect" })

    //#then
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe(`Error: File not found: ${missingPath}`)
  })

  test("#given a JSON path that is actually a directory #when preparing input #then returns ok:false instead of throwing", () => {
    //#given
    const dir = mkdtempSync(join(tmpdir(), "look-at-json-dir-"))
    const jsonDir = join(dir, "weird.json")
    mkdirSync(jsonDir)

    try {
      //#when
      const result = prepareLookAtInput({ file_path: jsonDir, goal: "inspect" })

      //#then
      expect(result.ok).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
