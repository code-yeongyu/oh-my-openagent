import { describe, test, expect } from "bun:test"
import { PROMETHEUS_SYSTEM_PROMPT } from "./prometheus"
import { PROMETHEUS_GPT_SYSTEM_PROMPT } from "./prometheus/gpt"
import { PROMETHEUS_GEMINI_SYSTEM_PROMPT } from "./prometheus/gemini"

describe("PROMETHEUS_SYSTEM_PROMPT Momus invocation policy", () => {
  test("should direct providing ONLY the file path string when invoking Momus", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toMatch(/momus.*only.*path|path.*only.*momus/)
  })

  test("should forbid wrapping Momus invocation in explanations or markdown", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toMatch(/not.*wrap|no.*explanation|no.*markdown/)
  })
})

describe("PROMETHEUS_SYSTEM_PROMPT zero human intervention", () => {
  test("should enforce universal zero human intervention rule", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when
    const lowerPrompt = prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("zero human intervention")
    expect(lowerPrompt).toContain("forbidden")
    expect(lowerPrompt).toMatch(/user manually tests|사용자가 직접 테스트/)
  })

  test("should require agent-executed QA scenarios as mandatory for all tasks", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when
    const lowerPrompt = prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("agent-executed qa scenarios")
    expect(lowerPrompt).toMatch(/mandatory.*all tasks|all tasks.*mandatory/)
  })

  test("should not contain ambiguous 'manual QA' terminology", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt).not.toMatch(/manual QA procedures/i)
    expect(prompt).not.toMatch(/manual verification procedures/i)
    expect(prompt).not.toMatch(/Manual-only/i)
  })

  test("should require per-scenario format with detailed structure", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when
    const lowerPrompt = prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("preconditions")
    expect(lowerPrompt).toContain("failure indicators")
    expect(lowerPrompt).toContain("evidence")
    expect(prompt).toMatch(/negative/i)
  })

  test("should require QA scenario adequacy in self-review checklist", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when
    const lowerPrompt = prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toMatch(/every task has agent-executed qa scenarios/)
    expect(lowerPrompt).toMatch(/happy-path and negative/)
    expect(lowerPrompt).toMatch(/zero acceptance criteria require human/)
  })
})

describe("PROMETHEUS_SYSTEM_PROMPT spec-driven framework awareness", () => {
  test("should contain openspec/ detection pattern", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt).toContain("openspec/")
  })

  test("should contain .specify/ detection pattern for Spec Kit (not .spec-kit/)", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when
    const hasCorrectPattern = prompt.includes(".specify/")
    const hasWrongPattern = prompt.includes(".spec-kit/")

    //#then
    expect(hasCorrectPattern).toBe(true)
    expect(hasWrongPattern).toBe(false)
  })

  test("should contain OpenSpec command references", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt).toContain("/opsx:propose")
    expect(prompt).toContain("specify spec")
  })

  test("should NOT contain wrong BMAD detection pattern", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt).not.toContain(".bmad/")
  })

  test("should contain spec-driven or spec-aware terminology", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toMatch(/spec.driven|spec.aware/)
  })
})

describe("PROMETHEUS_SYSTEM_PROMPT spec-driven intent type", () => {
  test("should contain Spec-Driven as an intent type", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt).toContain("Spec-Driven")
  })

  test("should preserve all original intent types unchanged", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when
    const originalIntents = [
      "Trivial/Simple",
      "Refactoring",
      "Build from Scratch",
      "Mid-sized Task",
      "Collaborative",
      "Architecture",
      "Research",
    ]

    //#then
    for (const intent of originalIntents) {
      expect(prompt).toContain(intent)
    }
  })

  test("should contain spec-first focus description for Spec-Driven intent", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toContain("spec-first")
  })
})

describe("PROMETHEUS_SYSTEM_PROMPT spec compliance section", () => {
  test("should contain Spec Framework Integration section header", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt).toContain("Spec Framework Integration")
  })

  test("should mark spec section as conditional (not mandatory)", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when
    const lowerPrompt = prompt.toLowerCase()

    //#then
    const hasIfDetected = lowerPrompt.includes("if detected")
    const hasOmitNote = lowerPrompt.includes("omit this section")
    expect(hasIfDetected || hasOmitNote).toBe(true)
  })

  test("should contain spec framework section (case-insensitive)", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toMatch(/spec framework/i)
  })
})

describe("PROMETHEUS_SYSTEM_PROMPT OpenSpec expanded commands", () => {
  test("should contain /opsx:ff fast-forward command", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt).toContain("/opsx:ff")
  })

  test("should contain /opsx:explore command", () => {
    //#given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt).toContain("/opsx:explore")
  })

describe("Prometheus prompts anti-duplication coverage", () => {
  test("all variants should include anti-duplication rules for delegated exploration", () => {
    // given
    const prompts = [
      PROMETHEUS_SYSTEM_PROMPT,
      PROMETHEUS_GPT_SYSTEM_PROMPT,
      PROMETHEUS_GEMINI_SYSTEM_PROMPT,
    ]

    // when / then
    for (const prompt of prompts) {
      expect(prompt).toContain("<Anti_Duplication>")
      expect(prompt).toContain("Anti-Duplication Rule")
      expect(prompt).toContain("DO NOT perform the same search yourself")
      expect(prompt).toContain("non-overlapping work")
    }
  })
})
