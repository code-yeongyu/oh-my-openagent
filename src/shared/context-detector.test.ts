/**
 * Context Detector Tests
 *
 * Tests for detecting project context (package manager, framework, etc.)
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  ContextDetector,
  createContextDetector,
  PackageManager,
  Framework,
  type ProjectContext,
} from "./context-detector"

describe("ContextDetector", () => {
  let detector: ContextDetector

  beforeEach(() => {
    detector = createContextDetector()
  })

  describe("package manager detection", () => {
    //#given project with bun.lockb
    //#when detecting package manager
    //#then should return bun
    it("should detect bun from bun.lockb", () => {
      detector.setMockFiles(["bun.lockb", "package.json"])
      const context = detector.detect(".")

      expect(context.packageManager).toBe(PackageManager.BUN)
    })

    it("should detect npm from package-lock.json", () => {
      detector.setMockFiles(["package-lock.json", "package.json"])
      const context = detector.detect(".")

      expect(context.packageManager).toBe(PackageManager.NPM)
    })

    it("should detect yarn from yarn.lock", () => {
      detector.setMockFiles(["yarn.lock", "package.json"])
      const context = detector.detect(".")

      expect(context.packageManager).toBe(PackageManager.YARN)
    })

    it("should detect pnpm from pnpm-lock.yaml", () => {
      detector.setMockFiles(["pnpm-lock.yaml", "package.json"])
      const context = detector.detect(".")

      expect(context.packageManager).toBe(PackageManager.PNPM)
    })

    it("should return unknown when no lock file found", () => {
      detector.setMockFiles(["package.json"])
      const context = detector.detect(".")

      expect(context.packageManager).toBe(PackageManager.UNKNOWN)
    })
  })

  describe("framework detection", () => {
    //#given project with next.config.js
    //#when detecting framework
    //#then should return nextjs
    it("should detect Next.js from next.config.js", () => {
      detector.setMockFiles(["next.config.js", "package.json"])
      const context = detector.detect(".")

      expect(context.framework).toBe(Framework.NEXTJS)
    })

    it("should detect React from react dependency", () => {
      detector.setMockFiles(["package.json"])
      detector.setMockDependencies({ react: "^18.0.0" })
      const context = detector.detect(".")

      expect(context.framework).toBe(Framework.REACT)
    })

    it("should detect Vue from vue.config.js", () => {
      detector.setMockFiles(["vue.config.js", "package.json"])
      const context = detector.detect(".")

      expect(context.framework).toBe(Framework.VUE)
    })

    it("should return unknown when no framework detected", () => {
      detector.setMockFiles(["package.json"])
      detector.setMockDependencies({})
      const context = detector.detect(".")

      expect(context.framework).toBe(Framework.UNKNOWN)
    })
  })

  describe("condition matching", () => {
    //#given hook with when condition
    //#when checking if condition matches
    //#then should return correct result
    it("should match package manager condition", () => {
      detector.setMockFiles(["bun.lockb", "package.json"])
      const context = detector.detect(".")

      const matches = detector.matchesCondition(context, {
        packageManager: PackageManager.BUN,
      })

      expect(matches).toBe(true)
    })

    it("should not match when package manager differs", () => {
      detector.setMockFiles(["yarn.lock", "package.json"])
      const context = detector.detect(".")

      const matches = detector.matchesCondition(context, {
        packageManager: PackageManager.BUN,
      })

      expect(matches).toBe(false)
    })

    it("should match framework condition", () => {
      detector.setMockFiles(["next.config.js", "package.json"])
      const context = detector.detect(".")

      const matches = detector.matchesCondition(context, {
        framework: Framework.NEXTJS,
      })

      expect(matches).toBe(true)
    })

    it("should match multiple conditions with AND logic", () => {
      detector.setMockFiles(["bun.lockb", "next.config.js", "package.json"])
      const context = detector.detect(".")

      const matches = detector.matchesCondition(context, {
        packageManager: PackageManager.BUN,
        framework: Framework.NEXTJS,
      })

      expect(matches).toBe(true)
    })

    it("should fail when any condition fails", () => {
      detector.setMockFiles(["bun.lockb", "package.json"])
      detector.setMockDependencies({})
      const context = detector.detect(".")

      const matches = detector.matchesCondition(context, {
        packageManager: PackageManager.BUN,
        framework: Framework.NEXTJS,
      })

      expect(matches).toBe(false)
    })
  })

  describe("empty condition", () => {
    it("should always match when no conditions specified", () => {
      detector.setMockFiles(["package.json"])
      const context = detector.detect(".")

      const matches = detector.matchesCondition(context, {})
      expect(matches).toBe(true)
    })
  })
})
