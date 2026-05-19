import { describe, expect, test } from "bun:test"
import { createSisyphusAgent } from "./sisyphus"

const GROK_4_3_MODEL = "xai/grok-4.3"

const SISYPHUS_OPERATION_CRITERIA = [
  "delegating well",
  "Manual QA Gate",
  "Parallelize aggressively",
  "task(category=",
  "lsp_diagnostics",
  "run_in_background=true",
  "Do not stop at analysis",
]

const GROK_4_3_OPERATION_CRITERIA = [
  "Sisyphus baseline preservation",
  "Hook-triggered workflow modes are execution triggers",
  "include at least one real tool call in the same assistant response",
  "OMO features are first-class tools",
  "Codebase mapping before edits",
]

function expectPromptIncludes(prompt: string, criteria: readonly string[]): void {
  expect(criteria.filter((criterion) => !prompt.includes(criterion))).toEqual([])
}

describe("Grok 4.3 Sisyphus harness", () => {
  test("#given Grok 4.3 #when Sisyphus is created #then core agent settings are usable", () => {
    const agent = createSisyphusAgent(GROK_4_3_MODEL)

    expect(agent.mode).toBe("primary")
    expect(agent.model).toBe(GROK_4_3_MODEL)
    expect(agent.maxTokens).toBe(64000)
    expect(agent.reasoningEffort).toBe("medium")
    expect(agent.permission).toHaveProperty("question", "allow")
    expect(agent.permission).toHaveProperty("call_omo_agent", "deny")
    expect(agent.permission).toHaveProperty("apply_patch", "deny")
  })

  test("#given Grok 4.3 #when Sisyphus prompt is built #then baseline orchestration behavior remains available", () => {
    const agent = createSisyphusAgent(GROK_4_3_MODEL)

    expectPromptIncludes(agent.prompt, SISYPHUS_OPERATION_CRITERIA)
  })

  test("#given Grok 4.3 #when Sisyphus prompt is built #then Grok execution guardrails are applied", () => {
    const agent = createSisyphusAgent(GROK_4_3_MODEL)

    expect(agent.prompt).toContain("based on Grok-4.3")
    expectPromptIncludes(agent.prompt, GROK_4_3_OPERATION_CRITERIA)
  })

  test("#given adjacent Grok versions #when Sisyphus is created #then only Grok 4.3 variants use the harness", () => {
    const grok43Variant = createSisyphusAgent("xai/grok-4.3-fast")
    const grok430 = createSisyphusAgent("xai/grok-4.30")
    const grok42 = createSisyphusAgent("xai/grok-4.2")

    expect(grok43Variant.prompt).toContain("Grok-4.3 Harness Overlay")
    expect(grok430.prompt).not.toContain("Grok-4.3 Harness Overlay")
    expect(grok42.prompt).not.toContain("Grok-4.3 Harness Overlay")
  })
})
