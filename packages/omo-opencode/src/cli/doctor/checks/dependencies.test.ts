/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as deps from "./dependencies"

afterEach(() => mock.restore())

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

    it("#given a zero-dependency install where the import probe throws Bun's non-Error ResolveMessage #when checking #then resolves to a report instead of crashing", async () => {
      //#given a real ResolveMessage captured from a genuinely failing import (lazycodex-ai ships no node_modules)
      const missingSpecifier = "definitely-not-a-real-package-omo-doctor-test"
      const resolveMessage: unknown = await import(missingSpecifier).then(
        () => {
          throw new Error("expected the import probe to fail")
        },
        (error: unknown) => error,
      )
      expect(resolveMessage instanceof Error).toBe(false)

      //#when checking with the failing probe injected
      const info = await deps.checkAstGrepNapi(() => Promise.reject(resolveMessage))

      //#then the probe failure degrades to a normal report (fallback paths may legitimately find a local install)
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

    it("#given a zero-dependency install where require.resolve throws Bun's non-Error ResolveMessage #when resolving package binary #then returns null instead of crashing", () => {
      //#given a real ResolveMessage captured from a genuinely failing require.resolve (lazycodex-ai ships no node_modules)
      const requireFromHere = createRequire(import.meta.url)
      let resolveMessage: unknown
      try {
        requireFromHere.resolve("definitely-not-a-real-package-omo-doctor-test/package.json")
        throw new Error("expected the require.resolve probe to fail")
      } catch (error) {
        resolveMessage = error
      }
      expect(resolveMessage instanceof Error).toBe(false)

      //#when resolving without an override so the failing resolver is exercised
      const result = deps.findCommentCheckerPackageBinary(undefined, () => {
        throw resolveMessage
      })

      //#then degrades to null instead of rethrowing
      expect(result).toBeNull()
    })
  })
})
