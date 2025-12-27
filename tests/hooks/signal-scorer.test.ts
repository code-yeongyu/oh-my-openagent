/**
 * Tests for signal scorer (LIF-73)
 */

import { describe, test, expect } from "bun:test"
import {
  computeSignalScore,
  formatSignalReport,
} from "../../src/hooks/meta-learning-extractor/signal-scorer"

describe("Signal Scorer", () => {
  describe("computeSignalScore", () => {
    describe("strong signals (3 points each)", () => {
      test("should detect edited_memory_files", () => {
        const filesModified = [".cursor/memory/architecture.md"]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.strongSignals.find(s => s.name === "edited_memory_files")
        expect(signal?.detected).toBe(true)
        expect(signal?.evidence).toContain(".cursor/memory/architecture.md")
      })

      test("should detect context/memory/ files", () => {
        const filesModified = ["context/memory/constitution.md"]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.strongSignals.find(s => s.name === "edited_memory_files")
        expect(signal?.detected).toBe(true)
      })

      test("should detect AGENTS.md files", () => {
        const filesModified = ["src/AGENTS.md"]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.strongSignals.find(s => s.name === "edited_memory_files")
        expect(signal?.detected).toBe(true)
      })

      test("should detect created_shared_utilities", () => {
        const filesModified = ["src/shared/utils.ts"]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.strongSignals.find(s => s.name === "created_shared_utilities")
        expect(signal?.detected).toBe(true)
      })

      test("should detect utils/ directory files", () => {
        const filesModified = ["src/utils/helpers.ts"]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.strongSignals.find(s => s.name === "created_shared_utilities")
        expect(signal?.detected).toBe(true)
      })

      test("should detect architectural_decisions from content", () => {
        const messages = [{ role: "assistant", content: "I decided to refactor the architecture" }]
        const result = computeSignalScore(messages, [], [])
        
        const signal = result.strongSignals.find(s => s.name === "architectural_decisions")
        expect(signal?.detected).toBe(true)
      })

      test("should detect cross_file_refactoring", () => {
        const filesModified = [
          "src/a/file1.ts",
          "src/b/file2.ts",
          "src/c/file3.ts",
          "src/d/file4.ts",
          "src/e/file5.ts",
        ]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.strongSignals.find(s => s.name === "cross_file_refactoring")
        expect(signal?.detected).toBe(true)
      })
    })

    describe("medium signals (2 points each)", () => {
      test("should detect decision_language", () => {
        const messages = [{ 
          role: "assistant", 
          content: "I decided to use this approach because it offers a better tradeoff" 
        }]
        const result = computeSignalScore(messages, [], [])
        
        const signal = result.mediumSignals.find(s => s.name === "decision_language")
        expect(signal?.detected).toBe(true)
      })

      test("should detect pattern_identification", () => {
        const messages = [{ 
          role: "assistant", 
          content: "This pattern should always be used consistently as a standard practice" 
        }]
        const result = computeSignalScore(messages, [], [])
        
        const signal = result.mediumSignals.find(s => s.name === "pattern_identification")
        expect(signal?.detected).toBe(true)
      })

      test("should detect cross_file_impact", () => {
        const filesModified = [
          "src/a/file1.ts",
          "src/b/file2.ts",
          "src/c/file3.ts",
        ]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.mediumSignals.find(s => s.name === "cross_file_impact")
        expect(signal?.detected).toBe(true)
      })
    })

    describe("weak signals (1 point each)", () => {
      test("should detect new_file_types", () => {
        const filesModified = [
          "src/file.ts",
          "src/file.json",
          "src/file.md",
        ]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.weakSignals.find(s => s.name === "new_file_types")
        expect(signal?.detected).toBe(true)
      })

      test("should detect config_changes", () => {
        const filesModified = ["config/settings.json"]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.weakSignals.find(s => s.name === "config_changes")
        expect(signal?.detected).toBe(true)
      })

      test("should detect yaml config files", () => {
        const filesModified = ["config.yaml"]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.weakSignals.find(s => s.name === "config_changes")
        expect(signal?.detected).toBe(true)
      })

      test("should detect dependency_changes", () => {
        const filesModified = ["package.json"]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.weakSignals.find(s => s.name === "dependency_changes")
        expect(signal?.detected).toBe(true)
      })

      test("should detect bun.lock changes", () => {
        const filesModified = ["bun.lock"]
        const result = computeSignalScore([], filesModified, [])
        
        const signal = result.weakSignals.find(s => s.name === "dependency_changes")
        expect(signal?.detected).toBe(true)
      })
    })

    describe("veto conditions", () => {
      test("should detect single_file_change", () => {
        const filesModified = ["src/file.ts"]
        const result = computeSignalScore([], filesModified, [])
        
        const veto = result.vetoConditions.find(v => v.name === "single_file_change")
        expect(veto?.detected).toBe(true)
      })

      test("should not trigger single_file_change for multiple files", () => {
        const filesModified = ["src/file1.ts", "src/file2.ts"]
        const result = computeSignalScore([], filesModified, [])
        
        const veto = result.vetoConditions.find(v => v.name === "single_file_change")
        expect(veto?.detected).toBe(false)
      })

      test("should detect environment_specific", () => {
        const messages = [{ 
          role: "assistant", 
          content: "This only works on my machine locally with specific env var settings" 
        }]
        const result = computeSignalScore(messages, [], [])
        
        const veto = result.vetoConditions.find(v => v.name === "environment_specific")
        expect(veto?.detected).toBe(true)
      })

      test("should detect speculation", () => {
        const messages = [{ 
          role: "assistant", 
          content: "This might work, maybe it could be the issue, probably not sure, possibly uncertain" 
        }]
        const result = computeSignalScore(messages, [], [])
        
        const veto = result.vetoConditions.find(v => v.name === "speculation")
        expect(veto?.detected).toBe(true)
      })
    })

    describe("score calculation", () => {
      test("should calculate total score correctly", () => {
        const filesModified = [
          ".cursor/memory/architecture.md",
          "src/shared/utils.ts",
        ]
        const result = computeSignalScore([], filesModified, [])
        
        expect(result.totalScore).toBeGreaterThanOrEqual(6)
      })

      test("should cap total score at 10", () => {
        const filesModified = [
          ".cursor/memory/architecture.md",
          "src/shared/utils.ts",
          "src/a/file1.ts",
          "src/b/file2.ts",
          "src/c/file3.ts",
          "src/d/file4.ts",
          "src/e/file5.ts",
        ]
        const messages = [{ 
          role: "assistant", 
          content: "I decided to refactor the architecture because of this tradeoff" 
        }]
        const result = computeSignalScore(messages, filesModified, [])
        
        expect(result.totalScore).toBeLessThanOrEqual(10)
      })

      test("should have threshold of 3", () => {
        const result = computeSignalScore([], [], [])
        expect(result.threshold).toBe(3)
      })
    })

    describe("shouldTrigger logic", () => {
      test("should trigger when score >= 3 and no veto", () => {
        const filesModified = [
          ".cursor/memory/architecture.md",
          "src/other.ts",
        ]
        const result = computeSignalScore([], filesModified, [])
        
        expect(result.totalScore).toBeGreaterThanOrEqual(3)
        expect(result.shouldTrigger).toBe(true)
      })

      test("should NOT trigger when score >= 3 but has veto", () => {
        const filesModified = [".cursor/memory/architecture.md"]
        const result = computeSignalScore([], filesModified, [])
        
        expect(result.totalScore).toBeGreaterThanOrEqual(3)
        expect(result.shouldTrigger).toBe(false)
      })

      test("should NOT trigger when score < 3", () => {
        const filesModified = ["src/file.ts", "src/file2.ts"]
        const result = computeSignalScore([], filesModified, [])
        
        expect(result.totalScore).toBeLessThan(3)
        expect(result.shouldTrigger).toBe(false)
      })

      test("should NOT trigger for empty session", () => {
        const result = computeSignalScore([], [], [])
        
        expect(result.totalScore).toBe(0)
        expect(result.shouldTrigger).toBe(false)
      })
    })
  })

  describe("formatSignalReport", () => {
    test("should format report with score and threshold", () => {
      const scoring = computeSignalScore([], [".cursor/memory/test.md", "src/other.ts"], [])
      const report = formatSignalReport(scoring)
      
      expect(report).toContain("Signal Score:")
      expect(report).toContain("/10")
      expect(report).toContain("threshold:")
    })

    test("should include shouldTrigger status", () => {
      const scoring = computeSignalScore([], [], [])
      const report = formatSignalReport(scoring)
      
      expect(report).toContain("Should Trigger")
    })

    test("should include strong signals section", () => {
      const scoring = computeSignalScore([], [], [])
      const report = formatSignalReport(scoring)
      
      expect(report).toContain("Strong Signals")
      expect(report).toContain("3 pts")
    })

    test("should include medium signals section", () => {
      const scoring = computeSignalScore([], [], [])
      const report = formatSignalReport(scoring)
      
      expect(report).toContain("Medium Signals")
      expect(report).toContain("2 pts")
    })

    test("should include weak signals section", () => {
      const scoring = computeSignalScore([], [], [])
      const report = formatSignalReport(scoring)
      
      expect(report).toContain("Weak Signals")
      expect(report).toContain("1 pt")
    })

    test("should include veto conditions when detected", () => {
      const scoring = computeSignalScore([], ["src/single.ts"], [])
      const report = formatSignalReport(scoring)
      
      expect(report).toContain("Veto Conditions")
      expect(report).toContain("BLOCKING")
    })

    test("should show checkmarks for detected signals", () => {
      const scoring = computeSignalScore([], [".cursor/memory/test.md", "src/other.ts"], [])
      const report = formatSignalReport(scoring)
      
      expect(report).toContain("✓")
    })

    test("should show X marks for undetected signals", () => {
      const scoring = computeSignalScore([], [], [])
      const report = formatSignalReport(scoring)
      
      expect(report).toContain("✗")
    })
  })
})
