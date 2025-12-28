import { describe, it, expect } from "bun:test"
import {
  createCodeReviewerAgent,
  CODE_REVIEWER_PROMPTS,
  codeReviewerAgent,
  type CodeReviewerMode,
} from "./code-reviewer"

describe("code-reviewer agent", () => {
  describe("createCodeReviewerAgent", () => {
    // #given default parameters
    // #when creating agent
    // #then should use default model and general prompt
    it("uses default model and general mode when no parameters provided", () => {
      const agent = createCodeReviewerAgent()

      expect(agent.model).toBe("opencode/grok-code")
      expect(agent.prompt).toBe(CODE_REVIEWER_PROMPTS.general)
      expect(agent.temperature).toBe(0.1)
      expect(agent.mode).toBe("subagent")
    })

    // #given custom model
    // #when creating agent with that model
    // #then should use the custom model
    it("uses custom model when provided", () => {
      const customModel = "openai/gpt-4"
      const agent = createCodeReviewerAgent(customModel)

      expect(agent.model).toBe(customModel)
      expect(agent.prompt).toBe(CODE_REVIEWER_PROMPTS.general)
    })

    // #given each available mode
    // #when creating agent with that mode via code_reviewer_mode option
    // #then should use corresponding prompt
    it("uses correct prompt for each mode via code_reviewer_mode option", () => {
      const modes: CodeReviewerMode[] = [
        "general",
        "silent_failure_hunter",
        "type_design_analyzer",
        "pr_test_analyzer",
      ]

      for (const mode of modes) {
        const agent = createCodeReviewerAgent(undefined, { code_reviewer_mode: mode })
        expect(agent.prompt).toBe(CODE_REVIEWER_PROMPTS[mode])
      }
    })

    // #given invalid code_reviewer_mode string
    // #when creating agent with invalid code_reviewer_mode
    // #then should fall back to general prompt
    it("falls back to general prompt when invalid code_reviewer_mode is provided", () => {
      const agent = createCodeReviewerAgent(undefined, { code_reviewer_mode: "invalid_mode" as any })
      expect(agent.prompt).toBe(CODE_REVIEWER_PROMPTS.general)
    })

    // #given undefined code_reviewer_mode
    // #when creating agent with empty options
    // #then should use general prompt
    it("uses general prompt when options are empty", () => {
      const agent = createCodeReviewerAgent(undefined, {})
      expect(agent.prompt).toBe(CODE_REVIEWER_PROMPTS.general)
    })

    // #given code-reviewer agent
    // #when checking tool permissions
    // #then should have write/edit/task disabled for safety
    it("has write, edit, task, and background_task disabled", () => {
      const agent = createCodeReviewerAgent()

      expect(agent.tools).toEqual({
        write: false,
        edit: false,
        task: false,
        background_task: false,
      })
    })

    // #given custom model and mode
    // #when creating agent with both parameters
    // #then should use both custom values
    it("accepts both custom model and code_reviewer_mode", () => {
      const agent = createCodeReviewerAgent(
        "google/gemini-pro",
        { code_reviewer_mode: "silent_failure_hunter" }
      )

      expect(agent.model).toBe("google/gemini-pro")
      expect(agent.prompt).toBe(CODE_REVIEWER_PROMPTS.silent_failure_hunter)
    })
  })

  describe("codeReviewerAgent export", () => {
    // #given the default export
    // #when checking its configuration
    // #then should be a valid agent with general mode
    it("is pre-configured with default settings", () => {
      expect(codeReviewerAgent.model).toBe("opencode/grok-code")
      expect(codeReviewerAgent.prompt).toBe(CODE_REVIEWER_PROMPTS.general)
      expect(codeReviewerAgent.mode).toBe("subagent")
    })
  })

  describe("CODE_REVIEWER_PROMPTS", () => {
    // #given the prompts object
    // #when checking its structure
    // #then should have all 4 personas defined
    it("has all 4 persona prompts defined", () => {
      expect(Object.keys(CODE_REVIEWER_PROMPTS)).toEqual([
        "general",
        "silent_failure_hunter",
        "type_design_analyzer",
        "pr_test_analyzer",
      ])
    })

    // #given each prompt
    // #when checking content
    // #then should be a non-empty string
    it("has non-empty prompt content for each mode", () => {
      for (const [mode, prompt] of Object.entries(CODE_REVIEWER_PROMPTS)) {
        expect(typeof prompt).toBe("string")
        expect(prompt.length).toBeGreaterThan(100)
      }
    })
  })
})
