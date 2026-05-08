import { describe, test, expect } from "bun:test"
import { ATLAS_SYSTEM_PROMPT } from "./default"
import { ATLAS_GPT_SYSTEM_PROMPT } from "./gpt"
import { ATLAS_GEMINI_SYSTEM_PROMPT } from "./gemini"
import { ATLAS_KIMI_SYSTEM_PROMPT } from "./kimi"
import { ATLAS_OPUS_47_SYSTEM_PROMPT } from "./opus-4-7"

const ALL_VARIANTS: Array<[string, string]> = [
  ["default", ATLAS_SYSTEM_PROMPT],
  ["gpt", ATLAS_GPT_SYSTEM_PROMPT],
  ["gemini", ATLAS_GEMINI_SYSTEM_PROMPT],
  ["kimi", ATLAS_KIMI_SYSTEM_PROMPT],
  ["opus-4-7", ATLAS_OPUS_47_SYSTEM_PROMPT],
]

describe("Atlas prompts auto-continue policy", () => {
  for (const [name, prompt] of ALL_VARIANTS) {
    test(`${name} variant should forbid asking user for continuation confirmation`, () => {
      const lowerPrompt = prompt.toLowerCase()

      expect(lowerPrompt).toContain("auto-continue policy")
      expect(lowerPrompt).toContain("never ask the user")
      expect(lowerPrompt).toContain("should i continue")
      expect(lowerPrompt).toContain("proceed to next task")
      expect(lowerPrompt).toContain("approval-style")
      expect(lowerPrompt).toContain("auto-continue immediately")
    })
  }

  test("all variants should require immediate continuation after verification passes", () => {
    for (const [, prompt] of ALL_VARIANTS) {
      const lowerPrompt = prompt.toLowerCase()
      expect(lowerPrompt).toMatch(/auto-continue immediately after verification/)
      expect(lowerPrompt).toMatch(/immediately delegate next task/)
    }
  })

  test("all variants should define when user interaction is actually needed", () => {
    for (const [, prompt] of ALL_VARIANTS) {
      const lowerPrompt = prompt.toLowerCase()
      expect(lowerPrompt).toMatch(/only pause.*truly blocked/)
      expect(lowerPrompt).toMatch(/plan needs clarification|blocked by external/)
    }
  })
})

describe("Atlas prompts anti-duplication coverage", () => {
  test("all variants should include anti-duplication rules for delegated exploration", () => {
    for (const [, prompt] of ALL_VARIANTS) {
      expect(prompt).toContain("<Anti_Duplication>")
      expect(prompt).toContain("Anti-Duplication Rule")
      expect(prompt).toContain("DO NOT perform the same search yourself")
      expect(prompt).toContain("non-overlapping work")
    }
  })
})

describe("Atlas prompts plan path consistency", () => {
  for (const [name, prompt] of ALL_VARIANTS) {
    test(`${name} variant should use .sisyphus/plans/{plan-name}.md path`, () => {
      expect(prompt).toContain(".sisyphus/plans/{plan-name}.md")
      expect(prompt).not.toContain(".sisyphus/tasks/{plan-name}.yaml")
      expect(prompt).not.toContain(".sisyphus/tasks/")
    })
  }

  test("all variants should read plan file after verification", () => {
    for (const [, prompt] of ALL_VARIANTS) {
      expect(prompt).toMatch(/read[\s\S]*?\.sisyphus\/plans\//i)
    }
  })

  test("all variants should distinguish top-level plan tasks from nested checkboxes", () => {
    for (const [, prompt] of ALL_VARIANTS) {
      const lowerPrompt = prompt.toLowerCase()
      expect(lowerPrompt).toMatch(/top-level.*checkbox/)
      expect(lowerPrompt).toMatch(/ignore nested.*checkbox/)
    }
  })
})

describe("Atlas prompts parallel-by-default mandate", () => {
  test("all variants should mandate parallel as the default delegation mode", () => {
    for (const [, prompt] of ALL_VARIANTS) {
      const lowerPrompt = prompt.toLowerCase()
      expect(lowerPrompt).toContain("parallel delegation")
      expect(lowerPrompt).toMatch(/default.*parallel|parallel.*default/)
      expect(lowerPrompt).toMatch(/sequential.*exception|exception.*sequential/)
    }
  })

  test("all variants should require named blocking dependency to justify sequential ordering", () => {
    for (const [, prompt] of ALL_VARIANTS) {
      const lowerPrompt = prompt.toLowerCase()
      expect(lowerPrompt).toMatch(/named.*depend|named.*block/)
    }
  })

  test("all variants should require parallel dispatch in ONE response", () => {
    for (const [, prompt] of ALL_VARIANTS) {
      const lowerPrompt = prompt.toLowerCase()
      expect(lowerPrompt).toMatch(/one (message|response)/)
    }
  })

  test("parallel mandate should appear BEFORE the workflow section in every variant", () => {
    for (const [name, prompt] of ALL_VARIANTS) {
      const mandateIdx = prompt.indexOf("<parallel_by_default>")
      const workflowIdx = prompt.indexOf("<workflow>")
      expect(mandateIdx, `${name}: mandate marker missing`).toBeGreaterThan(-1)
      expect(workflowIdx, `${name}: workflow marker missing`).toBeGreaterThan(-1)
      expect(mandateIdx, `${name}: mandate must precede workflow so "mandate above" references resolve`).toBeLessThan(workflowIdx)
    }
  })
})

describe("Atlas prompts use task_id (not session_id) for retries", () => {
  test("no variant should reference session_id (use task_id instead)", () => {
    for (const [name, prompt] of ALL_VARIANTS) {
      expect(prompt, `${name}: leaks session_id; should be task_id`).not.toMatch(/session_id/)
    }
  })

  test("all variants should mention task_id for retries", () => {
    for (const [name, prompt] of ALL_VARIANTS) {
      expect(prompt, `${name}: missing task_id retry reference`).toMatch(/task_id/)
    }
  })
})
