import { describe, expect, it } from "bun:test"
import {
  DELEGATE_TASK_ERROR_PATTERNS,
  detectDelegateTaskError,
  buildRetryGuidance,
} from "./index"

describe("sisyphus-task-retry", () => {
  describe("DELEGATE_TASK_ERROR_PATTERNS", () => {
    // given error patterns are defined
    // then should include all known task error types
    it("should contain all known error patterns", () => {
      expect(DELEGATE_TASK_ERROR_PATTERNS.length).toBeGreaterThanOrEqual(7)
      
      const patternTexts = DELEGATE_TASK_ERROR_PATTERNS.map(p => p.pattern)
      expect(patternTexts).toContain("'run_in_background' parameter is REQUIRED")
      expect(patternTexts).toContain("'load_skills' parameter is REQUIRED")
      expect(patternTexts).toContain('Unknown category: "')
      expect(patternTexts).toContain('Unknown agent: "')
    })
  })

  describe("detectDelegateTaskError", () => {
    // given tool output with run_in_background error
    // when detecting error
    // then should return matching error info
    it("should detect run_in_background missing error", () => {
      const output = "[ERROR] Invalid arguments: 'run_in_background' parameter is REQUIRED. Use run_in_background=false for task delegation."
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("missing_run_in_background")
    })

    it("should detect load_skills missing error", () => {
      const output = "[ERROR] Invalid arguments: 'load_skills' parameter is REQUIRED. Use load_skills=[] if no skills are needed."
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("missing_load_skills")
    })

    it("should detect unknown category error", () => {
      const output = '[ERROR] Unknown category: "invalid-cat". Available: visual-engineering, ultrabrain, quick'
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("unknown_category")
    })

    it("should detect unknown agent error", () => {
      const output = '[ERROR] Unknown agent: "fake-agent". Available agents: explore, librarian, oracle'
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("unknown_agent")
    })

    it("should return null for successful output", () => {
      const output = "Background task launched.\n\nTask ID: bg_12345\nSession ID: ses_abc"
      
      const result = detectDelegateTaskError(output)
      
      expect(result).toBeNull()
    })

    it("should detect bare unknown agent without [ERROR] prefix", () => {
      const output = 'Unknown agent: "deep". Available agents: explore, librarian, oracle'
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("unknown_agent")
    })

    it("should detect bare unknown category without [ERROR] prefix", () => {
      const output = 'Unknown category: "oraclee". Available: visual-engineering, ultrabrain, quick'
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("unknown_category")
    })

    it("should detect bare empty agent without [ERROR] prefix", () => {
      const output = 'Agent name cannot be empty.'
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("empty_agent")
    })

    it("should detect bare primary agent without [ERROR] prefix", () => {
      const output = 'Cannot call primary agent "plan" via task. Primary agents are top-level orchestrators.'
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("primary_agent")
    })

    it("should return unknown_delegate_task_error for prefixed unknown errors", () => {
      const output = '[ERROR] Some unexpected error occurred with the task system'
      
      const result = detectDelegateTaskError(output)
      
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("unknown_delegate_task_error")
    })

    it("should not false-positive on prose mentioning error concepts", () => {
      //#given a successful agent response discussing errors without matching the structural format
      const proseOutput = "I found the Unknown agent handler in task-target-resolver.ts. The Skills not found logic is in skill-resolver.ts."

      //#when
      const result = detectDelegateTaskError(proseOutput)

      //#then
      expect(result).toBeNull()
    })

    it("should not false-positive on prose mentioning Invalid arguments", () => {
      //#given
      const proseOutput = "Fixed the Invalid arguments handling in the validation layer."

      //#when
      const result = detectDelegateTaskError(proseOutput)

      //#then
      expect(result).toBeNull()
    })

    it("should not false-positive on long output containing error substrings", () => {
      //#given a long successful response that contains pattern substrings
      const longOutput = 'The task system returns Unknown agent: "X" errors when the catalog lookup fails. ' + "A".repeat(600)

      //#when
      const result = detectDelegateTaskError(longOutput)

      //#then structurally-anchored pattern still matches — this IS an error format
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("unknown_agent")
    })

    it("should detect errors in short error output", () => {
      //#given
      const shortOutput = 'Unknown agent: "foobar". Available agents: explore, oracle'

      //#when
      const result = detectDelegateTaskError(shortOutput)

      //#then
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("unknown_agent")
    })

    it("should detect skills not found with structural anchor", () => {
      //#given
      const output = "Skills not found: nonexistent-skill. Available: git-master, playwright"

      //#when
      const result = detectDelegateTaskError(output)

      //#then
      expect(result).not.toBeNull()
      expect(result?.errorType).toBe("unknown_skills")
    })
  })

  describe("buildRetryGuidance", () => {
    // given detected error
    // when building retry guidance
    // then should return actionable fix instructions
    it("should provide fix for missing run_in_background", () => {
      const errorInfo = { errorType: "missing_run_in_background", originalOutput: "" }
      
      const guidance = buildRetryGuidance(errorInfo)
      
      expect(guidance).toContain("run_in_background")
      expect(guidance).toContain("REQUIRED")
    })

    it("should provide fix for unknown category with available list", () => {
      const errorInfo = { 
        errorType: "unknown_category", 
        originalOutput: '[ERROR] Unknown category: "bad". Available: visual-engineering, ultrabrain' 
      }
      
      const guidance = buildRetryGuidance(errorInfo)
      
      expect(guidance).toContain("visual-engineering")
      expect(guidance).toContain("ultrabrain")
    })

    it("should provide fix for unknown agent with available list", () => {
      const errorInfo = {
        errorType: "unknown_agent",
        originalOutput: '[ERROR] Unknown agent: "fake". Available agents: explore, oracle'
      }

      const guidance = buildRetryGuidance(errorInfo)

      expect(guidance).toContain("explore")
      expect(guidance).toContain("oracle")
    })

    it("should include lane hint for unknown_agent explaining category vs subagent_type", () => {
      const errorInfo = {
        errorType: "unknown_agent",
        originalOutput: '[ERROR] Unknown agent: "deep". Available agents: explore, oracle'
      }

      const guidance = buildRetryGuidance(errorInfo)

      expect(guidance).toContain("category")
      expect(guidance).toContain("subagent_type")
      expect(guidance).toContain("Lane Hint")
    })

    it("should include lane hint for empty_agent", () => {
      const errorInfo = {
        errorType: "empty_agent",
        originalOutput: 'Agent name cannot be empty.'
      }

      const guidance = buildRetryGuidance(errorInfo)

      expect(guidance).toContain("Lane Hint")
      expect(guidance).toContain("category")
    })

    it("should include lane hint for primary_agent", () => {
      const errorInfo = {
        errorType: "primary_agent",
        originalOutput: 'Cannot call primary agent "plan" via task.'
      }

      const guidance = buildRetryGuidance(errorInfo)

      expect(guidance).toContain("Lane Hint")
      expect(guidance).toContain("category")
    })
  })
})
