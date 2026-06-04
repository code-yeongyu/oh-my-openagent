import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
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

  describe("findCommentCheckerPackageBinary", () => {
    let testDir: string
    const platformKey = `${process.platform}-${process.arch === "x64" ? "x64" : process.arch}`
    const binaryName = process.platform === "win32" ? "comment-checker.exe" : "comment-checker"

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), "cc-pkg-test-"))
    })

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true })
    })

    it("#given the package vendor binary exists #when resolving package binary #then returns vendor path", () => {
      //#given a package dir with binary at vendor/{platformKey}/
      const vendorDir = join(testDir, "vendor", platformKey)
      mkdirSync(vendorDir, { recursive: true })
      const expected = join(vendorDir, binaryName)
      writeFileSync(expected, "")

      //#when resolving with the package dir override
      const result = deps.findCommentCheckerPackageBinary(testDir)

      //#then returns the vendor path
      expect(result).toBe(expected)
    })

    it("#given only the legacy bin binary exists #when resolving package binary #then returns bin path", () => {
      //#given a package dir with binary only at bin/
      const binDir = join(testDir, "bin")
      mkdirSync(binDir, { recursive: true })
      const expected = join(binDir, binaryName)
      writeFileSync(expected, "")

      //#when resolving with the package dir override
      const result = deps.findCommentCheckerPackageBinary(testDir)

      //#then returns the bin path
      expect(result).toBe(expected)
    })
  })
})
