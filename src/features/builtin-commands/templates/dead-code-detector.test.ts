/**
 * Dead Code Detector Tests
 *
 * Tests for detecting unused exports and dependencies
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  DeadCodeDetector,
  createDeadCodeDetector,
  type DeadCodeResult,
  type UnusedExport,
} from "./dead-code-detector"

describe("DeadCodeDetector", () => {
  let detector: DeadCodeDetector

  beforeEach(() => {
    detector = createDeadCodeDetector()
  })

  describe("unused exports detection", () => {
    //#given file with unreferenced export function
    //#when running dead code detection
    //#then it should return unused export list
    it("should detect unused exports", async () => {
      const mockAnalysis = {
        unusedExports: [
          { file: "src/utils.ts", name: "unusedHelper", line: 42 },
          { file: "src/legacy.ts", name: "deprecatedFunc", line: 10 },
        ],
        unusedDependencies: [],
      }

      detector.setMockResults(mockAnalysis)
      const result = await detector.analyze(".")

      expect(result.unusedExports).toHaveLength(2)
      expect(result.unusedExports[0].name).toBe("unusedHelper")
    })

    it("should return empty array when no unused exports", async () => {
      const mockAnalysis = {
        unusedExports: [],
        unusedDependencies: [],
      }

      detector.setMockResults(mockAnalysis)
      const result = await detector.analyze(".")

      expect(result.unusedExports).toHaveLength(0)
    })
  })

  describe("unused dependencies detection", () => {
    //#given project with unused npm dependencies
    //#when running detection
    //#then it should return unused dependency list
    it("should detect unused dependencies", async () => {
      const mockAnalysis = {
        unusedExports: [],
        unusedDependencies: ["lodash", "moment"],
      }

      detector.setMockResults(mockAnalysis)
      const result = await detector.analyze(".")

      expect(result.unusedDependencies).toHaveLength(2)
      expect(result.unusedDependencies).toContain("lodash")
    })
  })

  describe("cleanup suggestions", () => {
    //#given detected dead code
    //#when generating suggestions
    //#then it should provide actionable cleanup advice
    it("should generate cleanup suggestions for unused exports", async () => {
      const mockAnalysis = {
        unusedExports: [
          { file: "src/utils.ts", name: "unusedHelper", line: 42 },
        ],
        unusedDependencies: [],
      }

      detector.setMockResults(mockAnalysis)
      const result = await detector.analyze(".")
      const suggestions = detector.generateSuggestions(result)

      expect(suggestions).toContain("建议删除以下未使用代码")
      expect(suggestions).toContain("src/utils.ts")
    })

    it("should generate suggestions for unused dependencies", async () => {
      const mockAnalysis = {
        unusedExports: [],
        unusedDependencies: ["lodash"],
      }

      detector.setMockResults(mockAnalysis)
      const result = await detector.analyze(".")
      const suggestions = detector.generateSuggestions(result)

      expect(suggestions).toContain("lodash")
    })

    it("should return no suggestions message when code is clean", async () => {
      const mockAnalysis = {
        unusedExports: [],
        unusedDependencies: [],
      }

      detector.setMockResults(mockAnalysis)
      const result = await detector.analyze(".")
      const suggestions = detector.generateSuggestions(result)

      expect(suggestions).toContain("未发现死代码")
    })
  })

  describe("ignore patterns", () => {
    it("should respect ignore patterns", async () => {
      const mockAnalysis = {
        unusedExports: [
          { file: "src/utils.ts", name: "unusedHelper", line: 42 },
          { file: "src/generated/types.ts", name: "GeneratedType", line: 1 },
        ],
        unusedDependencies: [],
      }

      detector.setMockResults(mockAnalysis)
      detector.setIgnorePatterns(["**/generated/**"])
      const result = await detector.analyze(".")

      // Should filter out generated files
      expect(result.unusedExports).toHaveLength(1)
      expect(result.unusedExports[0].file).toBe("src/utils.ts")
    })
  })

  describe("uncertain markers", () => {
    //#given dynamic imports in code
    //#when analyzing
    //#then it should mark as uncertain
    it("should mark dynamic imports as uncertain", async () => {
      const mockAnalysis = {
        unusedExports: [
          { file: "src/plugins/loader.ts", name: "loadPlugin", line: 5, isDynamic: true },
        ],
        unusedDependencies: [],
      }

      detector.setMockResults(mockAnalysis)
      const result = await detector.analyze(".")

      expect(result.uncertainExports).toHaveLength(1)
      expect(result.uncertainExports[0].name).toBe("loadPlugin")
    })
  })

  describe("fallback mode", () => {
    //#given knip is not installed
    //#when running detection
    //#then it should use basic detection fallback
    it("should use basic detection when knip unavailable", async () => {
      detector.setKnipAvailable(false)
      const result = await detector.analyze(".")

      expect(result.fallbackMode).toBe(true)
      expect(result.message).toContain("基本检测模式")
    })
  })
})
