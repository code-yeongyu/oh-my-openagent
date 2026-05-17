import { describe, it, expect, mock } from "bun:test"
import * as deps from "./dependencies"

describe("dependencies check", () => {
  describe("checkAstGrepCli", () => {
    it("returns valid dependency info", async () => {
      //#given ast-grep cli check
      //#when checking
      const info = await deps.checkAstGrepCli()

      //#then should return valid DependencyInfo
      expect(info.name).toBe("AST-Grep CLI")
      expect(info.required).toBe(false)
      expect(typeof info.installed).toBe("boolean")
      expect(typeof info.version === "string" || info.version === null).toBe(true)
      expect(typeof info.path === "string" || info.path === null).toBe(true)
    })
  })

  describe("checkAstGrepNapi", () => {
    it("returns valid dependency info", async () => {
      //#given ast-grep napi check
      //#when checking
      const info = await deps.checkAstGrepNapi()

      //#then should return valid DependencyInfo
      expect(info.name).toBe("AST-Grep NAPI")
      expect(info.required).toBe(false)
      expect(typeof info.installed).toBe("boolean")
    })
  })

  describe("checkCommentChecker", () => {
    it("returns valid dependency info", async () => {
      //#given comment checker check
      //#when checking
      const info = await deps.checkCommentChecker()

      //#then should return valid DependencyInfo
      expect(info.name).toBe("Comment Checker")
      expect(info.required).toBe(false)
      expect(typeof info.installed).toBe("boolean")
    })

    it("returns installed=true when cached binary exists", async () => {
      //#given cached binary exists
      const mockCachedPath = "/mock/path/to/comment-checker"
      
      mock.module("../../../hooks/comment-checker/downloader", () => ({
        getCachedBinaryPath: () => mockCachedPath,
        getCacheDir: () => "/mock/cache/dir",
        getBinaryName: () => "comment-checker",
        downloadCommentChecker: async () => mockCachedPath,
        ensureCommentCheckerBinary: async () => mockCachedPath,
      }))

      //#when checking
      const info = await deps.checkCommentChecker()

      //#then reports installed=true with cached path
      expect(info.installed).toBe(true)
      expect(info.path).toBe(mockCachedPath)
    })
  })
})
