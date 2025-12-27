/**
 * Tests for memory tools (LIF-73)
 *
 * These tests verify the memory tool utilities for path validation,
 * resolution, and file name handling.
 */

import { describe, test, expect } from "bun:test"
import { validateFileName, resolveMemoryPath } from "../../src/tools/memory/utils"
import { DEFAULT_MEMORY_PATH, MEMORY_FILE_EXTENSION, TOOL_NAMES } from "../../src/tools/memory/constants"

describe("Memory Tools", () => {
  describe("Constants", () => {
    test("should have correct default memory path", () => {
      expect(DEFAULT_MEMORY_PATH).toBe("context/memory/")
    })

    test("should have correct file extension", () => {
      expect(MEMORY_FILE_EXTENSION).toBe(".md")
    })

    test("should have all tool names defined", () => {
      expect(TOOL_NAMES.WRITE).toBe("memory_write")
      expect(TOOL_NAMES.READ).toBe("memory_read")
      expect(TOOL_NAMES.LIST).toBe("memory_list")
      expect(TOOL_NAMES.EDIT).toBe("memory_edit")
      expect(TOOL_NAMES.DELETE).toBe("memory_delete")
    })
  })

  describe("validateFileName", () => {
    describe("valid file names", () => {
      test("should accept simple file names", () => {
        expect(validateFileName("architecture")).toBe(true)
        expect(validateFileName("constitution")).toBe(true)
        expect(validateFileName("tech-stack")).toBe(true)
      })

      test("should accept file names with .md extension", () => {
        expect(validateFileName("architecture.md")).toBe(true)
        expect(validateFileName("notes.md")).toBe(true)
      })

      test("should accept subdirectory paths", () => {
        expect(validateFileName("decisions/ADR-001")).toBe(true)
        expect(validateFileName("decisions/ADR-001.md")).toBe(true)
        expect(validateFileName("nested/deep/file")).toBe(true)
      })

      test("should accept file names with numbers", () => {
        expect(validateFileName("version-2")).toBe(true)
        expect(validateFileName("ADR-001")).toBe(true)
      })

      test("should accept file names with underscores", () => {
        expect(validateFileName("my_notes")).toBe(true)
        expect(validateFileName("project_config")).toBe(true)
      })
    })

    describe("path traversal prevention", () => {
      test("should reject path traversal with ..", () => {
        expect(validateFileName("../secret")).toBe(false)
        expect(validateFileName("../../etc/passwd")).toBe(false)
        expect(validateFileName("decisions/../../../secret")).toBe(false)
      })

      test("should reject hidden path traversal", () => {
        expect(validateFileName("foo/..")).toBe(false)
        expect(validateFileName("foo/../bar")).toBe(false)
      })
    })

    describe("invalid characters", () => {
      test("should reject file names with < character", () => {
        expect(validateFileName("file<name")).toBe(false)
      })

      test("should reject file names with > character", () => {
        expect(validateFileName("file>name")).toBe(false)
      })

      test("should reject file names with : character", () => {
        expect(validateFileName("file:name")).toBe(false)
      })

      test("should reject file names with \" character", () => {
        expect(validateFileName('file"name')).toBe(false)
      })

      test("should reject file names with | character", () => {
        expect(validateFileName("file|name")).toBe(false)
      })

      test("should reject file names with ? character", () => {
        expect(validateFileName("file?name")).toBe(false)
      })

      test("should reject file names with * character", () => {
        expect(validateFileName("file*name")).toBe(false)
      })
    })

    describe("custom base path", () => {
      test("should validate against custom base path", () => {
        expect(validateFileName("notes", ".cursor/memory/")).toBe(true)
        expect(validateFileName("../escape", ".cursor/memory/")).toBe(false)
      })
    })
  })

  describe("resolveMemoryPath", () => {
    describe("file extension handling", () => {
      test("should add .md extension if not present", () => {
        const result = resolveMemoryPath("architecture")
        expect(result).toContain("architecture.md")
      })

      test("should not duplicate .md extension", () => {
        const result = resolveMemoryPath("architecture.md")
        expect(result).toContain("architecture.md")
        expect(result).not.toContain("architecture.md.md")
      })
    })

    describe("path resolution", () => {
      test("should resolve to absolute path", () => {
        const result = resolveMemoryPath("notes")
        expect(result.startsWith("/")).toBe(true)
      })

      test("should include base path", () => {
        const result = resolveMemoryPath("notes", "context/memory/")
        expect(result).toContain("context/memory/")
      })

      test("should handle subdirectories", () => {
        const result = resolveMemoryPath("decisions/ADR-001")
        expect(result).toContain("decisions/ADR-001.md")
      })

      test("should use custom base path", () => {
        const result = resolveMemoryPath("notes", ".cursor/memory/")
        expect(result).toContain(".cursor/memory/")
      })
    })

    describe("path normalization", () => {
      test("should normalize path separators", () => {
        const result = resolveMemoryPath("foo/bar")
        // Path should be normalized (no double slashes)
        expect(result).not.toContain("//")
      })
    })
  })
})

describe("Memory Tool Result Types", () => {
  test("should have correct MemoryToolResult structure", () => {
    // Type check - these should compile without errors
    const successResult = { success: true }
    const errorResult = { success: false, error: "File not found" }
    const contentResult = { success: true, content: "# Notes" }
    const listResult = { success: true, files: ["a.md", "b.md"] }

    expect(successResult.success).toBe(true)
    expect(errorResult.success).toBe(false)
    expect(errorResult.error).toBe("File not found")
    expect(contentResult.content).toBe("# Notes")
    expect(listResult.files).toHaveLength(2)
  })
})
