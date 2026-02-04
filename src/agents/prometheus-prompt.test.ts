import { describe, test, expect } from "bun:test"
import { PROMETHEUS_SYSTEM_PROMPT } from "./prometheus"

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
    expect(lowerPrompt).toMatch(/negative scenario/)
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
