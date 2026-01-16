import { describe, expect, it } from "bun:test"
import {
  DELEGATE_TASK_ERROR_PATTERNS,
  detectDelegateTaskError,
  buildRetryGuidance,
} from "./index"

describe("sisyphus-task-retry", () => {
  describe("DELEGATE_TASK_ERROR_PATTERNS", () => {
    // #given error patterns are defined
    // #then should include all known delegate_task error types
    it("should contain all known error patterns", () => {
      expect(DELEGATE_TASK_ERROR_PATTERNS.length).toBeGreaterThan(5)
      
      const patternTexts = DELEGATE_TASK_ERROR_PATTERNS.map(p => p.pattern)
      expect(patternTexts).toContain("run_in_background")
      expect(patternTexts).toContain("skills")
      expect(patternTexts).toContain("category OR subagent_type")
      expect(patternTexts).toContain("Unknown category")
      expect(patternTexts).toContain("Unknown agent")
    })
  })

  describe("detectDelegateTaskError", () => {
    // #given tool output with run_in_background error
    // #when detecting error
    // #then should return matching error info
    it("should detect run_in_background missing error", () => {
      const output = "❌ Invalid arguments: 'run_in_background' parameter is REQUIRED. Use run_in_background=false for task delegation."
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("missing_run_in_background")
    })

    it("should detect skills missing error", () => {
      const output = "❌ Invalid arguments: 'skills' parameter is REQUIRED. Use skills=[] if no skills needed."
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("missing_skills")
    })

    it("should detect category/subagent mutual exclusion error", () => {
      const output = "❌ Invalid arguments: Provide EITHER category OR subagent_type, not both."
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("mutual_exclusion")
    })

    it("should detect unknown category error", () => {
      const output = '❌ Unknown category: "invalid-cat". Available: visual-engineering, ultrabrain, quick'
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("unknown_category")
    })

    it("should detect unknown agent error", () => {
      const output = '❌ Unknown agent: "fake-agent". Available agents: explore, librarian, oracle'
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("unknown_agent")
    })

    it("should return null for successful output", () => {
      const output = "Background task launched.\n\nTask ID: bg_12345\nSession ID: ses_abc"
      
      const result = detectDelegateTaskError(output)
      
      expect(result).toBeNull()
    })
  })

  describe("buildRetryGuidance", () => {
    // #given detected error
    // #when building retry guidance
    // #then should return actionable fix instructions
    it("should provide fix for missing run_in_background", () => {
      const errorInfo = { errorType: "missing_run_in_background", originalOutput: "" }
      
      const guidance = buildRetryGuidance(errorInfo)
      
      expect(guidance).toContain("run_in_background")
      expect(guidance).toContain("REQUIRED")
    })

    it("should provide fix for unknown category with available list", () => {
      const errorInfo = { 
        errorType: "unknown_category", 
        originalOutput: '❌ Unknown category: "bad". Available: visual-engineering, ultrabrain' 
      }
      
      const guidance = buildRetryGuidance(errorInfo)
      
      expect(guidance).toContain("visual-engineering")
      expect(guidance).toContain("ultrabrain")
    })

    it("should provide fix for unknown agent with available list", () => {
      const errorInfo = { 
        errorType: "unknown_agent", 
        originalOutput: '❌ Unknown agent: "fake". Available agents: explore, oracle' 
      }
      
      const guidance = buildRetryGuidance(errorInfo)
      
      expect(guidance).toContain("explore")
      expect(guidance).toContain("oracle")
    })
  })
})
