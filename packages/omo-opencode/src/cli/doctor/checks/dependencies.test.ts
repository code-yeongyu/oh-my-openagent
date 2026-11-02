/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as deps from "./dependencies"
import * as downloader from "../../../hooks/comment-checker/downloader"

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

      spyOn(downloader, "getCachedBinaryPath").mockReturnValue(mockCachedPath)

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

    it("#given the per-platform package is installed beside the package #when resolving package binary #then returns the platform package binary", () => {
      //#given node_modules/@code-yeongyu/comment-checker plus its matching platform package
      const scopeDir = join(realpathSync(testDir), "node_modules", "@code-yeongyu")
      const packageDir = join(scopeDir, "comment-checker")
      const platformDir = join(scopeDir, `comment-checker-${platformKey}`)
      mkdirSync(packageDir, { recursive: true })
      mkdirSync(join(platformDir, "bin"), { recursive: true })
      writeFileSync(join(packageDir, "package.json"), "{}")
      writeFileSync(join(platformDir, "package.json"), "{}")
      const expected = join(platformDir, "bin", binaryName)
      writeFileSync(expected, "")

      //#when resolving through the package.json resolver
      const result = deps.findCommentCheckerPackageBinary(undefined, () => join(packageDir, "package.json"))

      //#then returns the platform package binary
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

    it("#given a zero-dependency install where require.resolve throws Bun's ResolveMessage #when resolving package binary #then returns null instead of crashing", () => {
      //#given a real ResolveMessage captured from a genuinely failing require.resolve (lazycodex-ai ships no node_modules)
      const requireFromHere = createRequire(import.meta.url)
      let resolveMessage: unknown
      try {
        requireFromHere.resolve("definitely-not-a-real-package-omo-doctor-test/package.json")
        throw new Error("expected the require.resolve probe to fail")
      } catch (error) {
        resolveMessage = error
      }
      // Bun 1.4 made ResolveMessage extend Error; assert the stable identity, not the prototype.
      expect((resolveMessage as { name?: string }).name).toBe("ResolveMessage")

      //#when resolving without an override so the failing resolver is exercised
      const result = deps.findCommentCheckerPackageBinary(undefined, () => {
        throw resolveMessage
      })

      //#then degrades to null instead of rethrowing
      expect(result).toBeNull()
    })
  })
})
