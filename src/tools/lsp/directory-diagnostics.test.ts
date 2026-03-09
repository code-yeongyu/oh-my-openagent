import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import os from "os"

import * as configModule from "./config"
import { lspManager } from "./lsp-server"
import { isDirectoryPath } from "./lsp-client-wrapper"
import { aggregateDiagnosticsForDirectory } from "./directory-diagnostics"
import type { Diagnostic } from "./types"

const diagnosticsMock = mock(async (_filePath: string) => ({ items: [] as Diagnostic[] }))
const getClientMock = mock(async () => ({ diagnostics: diagnosticsMock }))
const releaseClientMock = mock(() => {})

function createDiagnostic(message: string): Diagnostic {
  return {
    message,
    severity: 1,
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
  }
}

describe("directory diagnostics", () => {
  beforeEach(() => {
    diagnosticsMock.mockReset()
    diagnosticsMock.mockImplementation(async (_filePath: string) => ({ items: [] }))
    getClientMock.mockClear()
    releaseClientMock.mockClear()

    spyOn(configModule, "findServerForExtension").mockReturnValue({
      status: "found",
      server: {
        id: "test-server",
        command: ["test-server"],
        extensions: [".ts"],
        priority: 1,
      },
    })
    spyOn(lspManager, "getClient").mockImplementation(getClientMock)
    spyOn(lspManager, "releaseClient").mockImplementation(releaseClientMock)
  })

  afterEach(() => {
    mock.restore()
  })

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

    it("#given diagnostics from multiple files #when aggregating directory diagnostics #then each entry includes the source file path", async () => {
      const tmp = mkdtempSync(join(os.tmpdir(), "omo-aggr-files-"))
      try {
        const firstFile = join(tmp, "first.ts")
        const secondFile = join(tmp, "second.ts")

        writeFileSync(firstFile, "export const first = true\n")
        writeFileSync(secondFile, "export const second = true\n")

        diagnosticsMock.mockImplementation(async (filePath: string) => ({
          items: [createDiagnostic(`problem in ${filePath}`)],
        }))

        const result = await aggregateDiagnosticsForDirectory(tmp, ".ts")

        expect(result).toContain(`${firstFile}: error at 1:0: problem in ${firstFile}`)
        expect(result).toContain(`${secondFile}: error at 1:0: problem in ${secondFile}`)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  })
})
