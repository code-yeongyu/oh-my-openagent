/**
 * Skill Auto-Injector Tests
 */

import { describe, test, expect } from "bun:test"
import {
  detectSkillsFromPrompt,
  getTopSkillToInject,
  DEFAULT_DETECTOR_CONFIG,
} from "./detectors"
import { createSkillAutoInjectorHook } from "./index"

describe("Skill Auto-Injector", () => {
  describe("detectSkillsFromPrompt", () => {
    test("should detect git-master for git commit", () => {
      // #given - prompt with git commit
      const prompt = "Please commit these changes with a good message"

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt)

      // #then - should detect git-master
      expect(results.some(r => r.skill === "git-master")).toBe(true)
    })

    test("should detect git-master for rebase", () => {
      // #given - prompt with rebase
      const prompt = "I need to rebase my branch onto main"

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt)

      // #then - should detect git-master
      expect(results.some(r => r.skill === "git-master")).toBe(true)
    })

    test("should detect git-master for squash", () => {
      // #given - prompt with squash
      const prompt = "Can you squash these commits together?"

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt)

      // #then - should detect git-master
      expect(results.some(r => r.skill === "git-master")).toBe(true)
    })

    test("should detect playwright for browser automation", () => {
      // #given - prompt with browser automation
      const prompt = "I need to automate browser testing for this page"

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt)

      // #then - should detect playwright
      expect(results.some(r => r.skill === "playwright")).toBe(true)
    })

    test("should detect playwright for screenshot", () => {
      // #given - prompt with screenshot
      const prompt = "Take a screenshot of the login page"

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt)

      // #then - should detect playwright
      expect(results.some(r => r.skill === "playwright")).toBe(true)
    })

    test("should detect frontend-ui-ux for React component", () => {
      // #given - prompt with frontend terms
      const prompt = "Create a React component with responsive CSS styling"

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt)

      // #then - should detect frontend-ui-ux
      expect(results.some(r => r.skill === "frontend-ui-ux")).toBe(true)
    })

    test("should detect tdd for test-driven", () => {
      // #given - prompt with TDD
      const prompt = "Let's use TDD to implement this feature"

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt)

      // #then - should detect tdd
      expect(results.some(r => r.skill === "tdd")).toBe(true)
    })

    test("should detect systematic-debugging for bug fix", () => {
      // #given - prompt with debugging
      const prompt = "There's a bug in the login, it's not working and crashes"

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt)

      // #then - should detect systematic-debugging
      expect(results.some(r => r.skill === "systematic-debugging")).toBe(true)
    })

    test("should return empty for unrelated prompt", () => {
      // #given - unrelated prompt
      const prompt = "What time is it?"

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt)

      // #then - should return empty
      expect(results.length).toBe(0)
    })

    test("should respect disabled skills", () => {
      // #given - prompt with git but git-master disabled
      const prompt = "Please commit these changes"
      const config = {
        ...DEFAULT_DETECTOR_CONFIG,
        disabled_skills: ["git-master" as const],
      }

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt, config)

      // #then - should not include git-master
      expect(results.some(r => r.skill === "git-master")).toBe(false)
    })

    test("should return empty when disabled", () => {
      // #given - disabled config
      const prompt = "Please commit these changes"
      const config = { ...DEFAULT_DETECTOR_CONFIG, enabled: false }

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt, config)

      // #then - should return empty
      expect(results.length).toBe(0)
    })

    test("should sort by confidence", () => {
      // #given - prompt with multiple skill matches
      const prompt = "git commit and git push and git rebase the changes"

      // #when - detecting skills
      const results = detectSkillsFromPrompt(prompt)

      // #then - should be sorted by confidence (highest first)
      if (results.length > 1) {
        expect(results[0].confidence).toBeGreaterThanOrEqual(results[1].confidence)
      }
    })
  })

  describe("getTopSkillToInject", () => {
    test("should return top skill", () => {
      // #given - prompt with git
      const prompt = "Please commit these changes"

      // #when - getting top skill
      const result = getTopSkillToInject(prompt)

      // #then - should return git-master
      expect(result).not.toBeNull()
      expect(result!.skill).toBe("git-master")
    })

    test("should skip already loaded skills", () => {
      // #given - prompt with git but git-master already loaded
      const prompt = "Please commit these changes"
      const alreadyLoaded = ["git-master"]

      // #when - getting top skill
      const result = getTopSkillToInject(prompt, alreadyLoaded)

      // #then - should return null (no other skill detected)
      expect(result).toBeNull()
    })

    test("should return null for unrelated prompt", () => {
      // #given - unrelated prompt
      const prompt = "Hello world"

      // #when - getting top skill
      const result = getTopSkillToInject(prompt)

      // #then - should return null
      expect(result).toBeNull()
    })
  })

  describe("createSkillAutoInjectorHook", () => {
    test("should create hook with correct structure", () => {
      // #given - context
      const ctx = { cwd: "/test" }

      // #when - creating hook
      const hook = createSkillAutoInjectorHook(ctx)

      // #then - should have expected structure
      expect(hook.name).toBe("skill-auto-injector")
      expect(hook["chat.message"]).toBeDefined()
      expect(hook.event).toBeDefined()
    })

    test("should inject skill for git prompt", async () => {
      // #given - hook and git prompt
      const ctx = { cwd: "/test" }
      const hook = createSkillAutoInjectorHook(ctx)
      const input = { sessionID: "test-session" }
      const output: {
        parts: Array<{ type: string; text: string }>
        messages?: Array<{ role: string; content: string }>
      } = {
        parts: [{ type: "text", text: "Please commit these changes" }],
      }

      // #when - hook is called
      await hook["chat.message"](input, output)

      // #then - should inject git-master
      expect(output.messages).toBeDefined()
      expect(output.messages!.length).toBeGreaterThan(0)
      expect(output.messages![0].content).toContain("git-master")
    })

    test("should not inject duplicate skills in same session", async () => {
      // #given - hook called twice with git prompts
      const ctx = { cwd: "/test" }
      const hook = createSkillAutoInjectorHook(ctx)
      const input = { sessionID: "test-session-2" }

      const output1: {
        parts: Array<{ type: string; text: string }>
        messages?: Array<{ role: string; content: string }>
      } = {
        parts: [{ type: "text", text: "Please commit these changes" }],
      }

      const output2: {
        parts: Array<{ type: string; text: string }>
        messages?: Array<{ role: string; content: string }>
      } = {
        parts: [{ type: "text", text: "Now push the commit" }],
      }

      // #when - hook is called twice
      await hook["chat.message"](input, output1)
      await hook["chat.message"](input, output2)

      // #then - first call should inject, second should not
      expect(output1.messages!.length).toBe(1)
      expect(output2.messages).toBeUndefined() // No new messages added
    })

    test("should not inject when disabled", async () => {
      // #given - disabled hook
      const ctx = { cwd: "/test" }
      const hook = createSkillAutoInjectorHook(ctx, { config: { enabled: false } })
      const input = { sessionID: "test-session-3" }
      const output: {
        parts: Array<{ type: string; text: string }>
        messages?: Array<{ role: string; content: string }>
      } = {
        parts: [{ type: "text", text: "Please commit these changes" }],
      }

      // #when - hook is called
      await hook["chat.message"](input, output)

      // #then - should not inject
      expect(output.messages).toBeUndefined()
    })
  })
})
