import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import os from "os"

import { isDirectoryPath } from "./lsp-client-wrapper"
import { aggregateDiagnosticsForDirectory } from "./directory-diagnostics"

describe("directory diagnostics", () => {
  describe("isDirectoryPath", () => {
    it("returns true for existing directory", () => {
      const tmp = mkdtempSync(join(os.tmpdir(), "omo-isdir-"))
      try {
        expect(isDirectoryPath(tmp)).toBe(true)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })

    it("returns false for existing file", () => {
      const tmp = mkdtempSync(join(os.tmpdir(), "omo-isdir-file-"))
      try {
        const file = join(tmp, "test.txt")
        writeFileSync(file, "content")
        expect(isDirectoryPath(file)).toBe(false)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })

    it("returns false for non-existent path", () => {
      const nonExistent = join(os.tmpdir(), "omo-nonexistent-" + Date.now())
      expect(isDirectoryPath(nonExistent)).toBe(false)
    })
  })

  describe("aggregateDiagnosticsForDirectory", () => {
    it("throws error when extension does not start with dot", async () => {
      const tmp = mkdtempSync(join(os.tmpdir(), "omo-aggr-ext-"))
      try {
        await expect(aggregateDiagnosticsForDirectory(tmp, "ts")).rejects.toThrow(
          'Extension must start with a dot (e.g., ".ts", not "ts")'
        )
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })

    it("throws error when directory does not exist", async () => {
      const nonExistent = join(os.tmpdir(), "omo-nonexistent-dir-" + Date.now())
      await expect(aggregateDiagnosticsForDirectory(nonExistent, ".ts")).rejects.toThrow(
        "Directory does not exist"
      )
    })
  })
})
