import { describe, test, expect } from "bun:test"
import { createCoeusAgent, COEUS_SYSTEM_PROMPT, coeusPromptMetadata } from "./index"

describe("COEUS_SYSTEM_PROMPT policy requirements", () => {
  test("should identify as Titan of intellect and recursive planner", () => {
    //#given
    const prompt = COEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toContain("titan")
    expect(prompt.toLowerCase()).toContain("intellect")
    expect(prompt.toLowerCase()).toContain("recursive")
    expect(prompt.toLowerCase()).toContain("planner")
  })

  test("should NOT identify as implementer", () => {
    //#given
    const prompt = COEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toMatch(/not.*implement|never.*implement/)
  })

  test("should contain complexity analysis instructions", () => {
    //#given
    const prompt = COEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toContain("complexity")
    expect(prompt.toLowerCase()).toMatch(/score|scoring|analys/)
  })

  test("should contain decomposition decision workflow", () => {
    //#given
    const prompt = COEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toContain("decompose")
    expect(prompt.toLowerCase()).toContain("decomposition")
  })

  test("should contain global constraints generation", () => {
    //#given
    const prompt = COEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toContain("global constraints")
  })

  test("should contain sub-prometheus spawning instructions", () => {
    //#given
    const prompt = COEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toContain("sub-prometheus")
  })

  test("should contain merge and conflict resolution instructions", () => {
    //#given
    const prompt = COEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toContain("merge")
    expect(prompt.toLowerCase()).toMatch(/conflict|resolv/)
  })

  test("should contain validation step", () => {
    //#given
    const prompt = COEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt.toLowerCase()).toContain("validate")
  })

  test("should output Sisyphus-compatible plan format", () => {
    //#given
    const prompt = COEUS_SYSTEM_PROMPT

    //#when / #then
    expect(prompt).toContain(".sisyphus/plans/")
    expect(prompt).toContain(".md")
  })
})

describe("createCoeusAgent factory", () => {
  test("should return AgentConfig with mode 'all'", () => {
    //#given
    const model = "test-model"

    //#when
    const config = createCoeusAgent(model)

    //#then
    expect(config.mode).toBe("all")
  })

  test("should allow edit, bash, webfetch, question tools (COEUS_PERMISSION)", () => {
    //#given
    const model = "test-model"

    //#when
    const config = createCoeusAgent(model)

    //#then
    expect(config.permission).toBeDefined()
    expect(config.permission!["edit"]).toBe("allow")
    expect(config.permission!["bash"]).toBe("allow")
    expect(config.permission!["webfetch"]).toBe("allow")
    expect(config.permission!["question"]).toBe("allow")
  })

  test("should NOT deny task tool (plan family can delegate)", () => {
    //#given
    const model = "test-model"

    //#when
    const config = createCoeusAgent(model)

    //#then
    expect(config.permission!["task"]).toBeUndefined()
  })

  test("should set temperature to 0.1", () => {
    //#given
    const model = "test-model"

    //#when
    const config = createCoeusAgent(model)

    //#then
    expect(config.temperature).toBe(0.1)
  })

  test("should enable thinking with 32k budget", () => {
    //#given
    const model = "test-model"

    //#when
    const config = createCoeusAgent(model)

    //#then
    expect(config.thinking).toEqual({
      type: "enabled",
      budgetTokens: 32000,
    })
  })

  test("should use provided model", () => {
    //#given
    const model = "anthropic/claude-opus-4-6"

    //#when
    const config = createCoeusAgent(model)

    //#then
    expect(config.model).toBe("anthropic/claude-opus-4-6")
  })

  test("should have static mode property", () => {
    //#then
    expect(createCoeusAgent.mode).toBe("all")
  })

  test("should include system prompt", () => {
    //#given
    const model = "test-model"

    //#when
    const config = createCoeusAgent(model)

    //#then
    expect(config.prompt).toBe(COEUS_SYSTEM_PROMPT)
  })

  test("should have description mentioning recursive planning", () => {
    //#given
    const model = "test-model"

    //#when
    const config = createCoeusAgent(model)

    //#then
    expect(config.description).toBeDefined()
    expect(config.description!.toLowerCase()).toMatch(/recursive/)
  })
})

describe("coeusPromptMetadata", () => {
  test("should have advisor category", () => {
    expect(coeusPromptMetadata.category).toBe("advisor")
  })

  test("should have EXPENSIVE cost", () => {
    expect(coeusPromptMetadata.cost).toBe("EXPENSIVE")
  })

  test("should have triggers", () => {
    expect(coeusPromptMetadata.triggers.length).toBeGreaterThan(0)
  })
})
