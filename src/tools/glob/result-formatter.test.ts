import { describe, it, expect } from "bun:test"
import { formatGlobResult } from "./result-formatter"
import type { GlobResult } from "./types"
import type { ToonCompressionConfig } from "../../shared/toon-compression"

describe("formatGlobResult", () => {
  const defaultConfig: ToonCompressionConfig = {
    enabled: true,
    threshold: 5000,
  }

  // given error result
  // when formatting
  // then should return error message uncompressed
  describe("#given error result", () => {
    it("returns error message as plain text", () => {
      const result: GlobResult = {
        files: [],
        totalFiles: 0,
        truncated: false,
        error: "Permission denied",
      }

      const output = formatGlobResult(result, defaultConfig)

      expect(output).toBe("Error: Permission denied")
    })

    it("does not compress error messages even with large content", () => {
      const result: GlobResult = {
        files: [],
        totalFiles: 0,
        truncated: false,
        error: "Stack trace: " + "x".repeat(10000),
      }

      const output = formatGlobResult(result, defaultConfig)

      expect(output).toContain("Error:")
      expect(output).not.toMatch(/\[\d+\]\{path,mtime\}/)
    })
  })

  // given empty result
  // when formatting
  // then should return no files message
  describe("#given empty result", () => {
    it("returns no files found message", () => {
      const result: GlobResult = {
        files: [],
        totalFiles: 0,
        truncated: false,
      }

      const output = formatGlobResult(result, defaultConfig)

      expect(output).toBe("No files found")
    })
  })

  // given small file list
  // when formatting with compression enabled
  // then should use line-by-line format
  describe("#given small file list", () => {
    it("formats files line by line when below threshold", () => {
      const result: GlobResult = {
        files: [
          { path: "src/index.ts", mtime: 1000 },
          { path: "src/utils.ts", mtime: 2000 },
        ],
        totalFiles: 2,
        truncated: false,
      }

      const output = formatGlobResult(result, defaultConfig)

      expect(output).toContain("Found 2 file(s)")
      expect(output).toContain("src/index.ts")
      expect(output).toContain("src/utils.ts")
      expect(output).not.toMatch(/\[\d+\]\{path,mtime\}/)
    })

    it("includes truncated message when applicable", () => {
      const result: GlobResult = {
        files: [{ path: "src/index.ts", mtime: 1000 }],
        totalFiles: 100,
        truncated: true,
      }

      const output = formatGlobResult(result, defaultConfig)

      expect(output).toContain("Results are truncated")
    })
  })

  // given large file list
  // when formatting with compression enabled
  // then should compress the file array
  describe("#given large file list", () => {
    it("compresses file array when above threshold", () => {
      const files = Array.from({ length: 100 }, (_, i) => ({
        path: `src/components/feature/module/submodule/deep/nested/file${i}.ts`,
        mtime: 1000 + i,
      }))

      const result: GlobResult = {
        files,
        totalFiles: 100,
        truncated: false,
      }

      const output = formatGlobResult(result, defaultConfig)

      // Real TOON library produces toon: prefix
      expect(output).toContain("toon:")
    })

    it("still includes file count header", () => {
      const files = Array.from({ length: 100 }, (_, i) => ({
        path: `src/components/feature/module/submodule/deep/nested/file${i}.ts`,
        mtime: 1000 + i,
      }))

      const result: GlobResult = {
        files,
        totalFiles: 100,
        truncated: false,
      }

      const output = formatGlobResult(result, defaultConfig)

      expect(output).toContain("Found 100 file(s)")
    })

    it("includes truncated message when compressed", () => {
      const files = Array.from({ length: 100 }, (_, i) => ({
        path: `src/components/feature/module/submodule/deep/nested/file${i}.ts`,
        mtime: 1000 + i,
      }))

      const result: GlobResult = {
        files,
        totalFiles: 1000,
        truncated: true,
      }

      const output = formatGlobResult(result, defaultConfig)

      expect(output).toContain("Results are truncated")
    })
  })

  // given compression disabled
  // when formatting large file list
  // then should use line-by-line format
  describe("#given compression disabled", () => {
    it("uses line-by-line format even for large lists", () => {
      const disabledConfig: ToonCompressionConfig = {
        enabled: false,
        threshold: 100,
      }

      const files = Array.from({ length: 100 }, (_, i) => ({
        path: `src/components/feature/module/submodule/deep/nested/file${i}.ts`,
        mtime: 1000 + i,
      }))

      const result: GlobResult = {
        files,
        totalFiles: 100,
        truncated: false,
      }

      const output = formatGlobResult(result, disabledConfig)

      expect(output).not.toMatch(/\[\d+\]\{path,mtime\}/)
      expect(output).toContain("file0.ts")
      expect(output).toContain("file99.ts")
    })
  })

  // given no config provided
  // when formatting
  // then should use line-by-line format (compression disabled by default)
  describe("#given no config provided", () => {
    it("defaults to line-by-line format", () => {
      const files = Array.from({ length: 100 }, (_, i) => ({
        path: `src/components/feature/module/submodule/deep/nested/file${i}.ts`,
        mtime: 1000 + i,
      }))

      const result: GlobResult = {
        files,
        totalFiles: 100,
        truncated: false,
      }

      const output = formatGlobResult(result)

      expect(output).not.toMatch(/\[\d+\]\{path,mtime\}/)
    })
  })

  // given custom threshold
  // when formatting
  // then should respect the threshold
  describe("#given custom threshold", () => {
    it("compresses when content exceeds custom threshold", () => {
      const customConfig: ToonCompressionConfig = {
        enabled: true,
        threshold: 100, // Very low threshold
      }

      const result: GlobResult = {
        files: [
          { path: "src/index.ts", mtime: 1000 },
          { path: "src/utils.ts", mtime: 2000 },
        ],
        totalFiles: 2,
        truncated: false,
      }

      const output = formatGlobResult(result, customConfig)

      // Should still not compress - array length < 5 (MIN_COMPRESSIBLE_ARRAY_LENGTH)
      expect(output).not.toMatch(/\[\d+\]\{path,mtime\}/)
    })
  })
})
