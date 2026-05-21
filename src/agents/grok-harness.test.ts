import { describe, expect, test } from "bun:test"
import { createSisyphusAgent } from "./sisyphus"

const GROK_4_3_MODEL = "xai/grok-4.3"
const GROK_BUILD_MODEL = "xai/grok-build-0.1"

const SISYPHUS_OPERATION_CRITERIA = [
  "delegating well",
  "Manual QA Gate",
  "Parallelize aggressively",
  "task(category=",
  "lsp_diagnostics",
  "run_in_background=true",
  "Do not stop at analysis",
]

const GROK_OPERATION_CRITERIA = [
  "Sisyphus baseline preservation",
  "Hook-triggered workflow modes are execution triggers",
  "include at least one real tool call in the same assistant response",
  "OMO features are first-class tools",
  "Codebase mapping before edits",
]

function expectPromptIncludes(prompt: string, criteria: readonly string[]): void {
  expect(criteria.filter((criterion) => !prompt.includes(criterion))).toEqual([])
}

describe("Grok Sisyphus harness", () => {
  test("#given supported Grok models #when Sisyphus is created #then core agent settings are usable", () => {
    for (const model of [GROK_4_3_MODEL, GROK_BUILD_MODEL]) {
      const agent = createSisyphusAgent(model)

      expect(agent.mode).toBe("primary")
      expect(agent.model).toBe(model)
      expect(agent.maxTokens).toBe(64000)
      expect(agent.reasoningEffort).toBe("medium")
      expect(agent.permission).toHaveProperty("question", "allow")
      expect(agent.permission).toHaveProperty("call_omo_agent", "deny")
      expect(agent.permission).toHaveProperty("apply_patch", "deny")
    }
  })

  test("#given supported Grok model #when Sisyphus prompt is built #then baseline orchestration behavior remains available", () => {
    const agent = createSisyphusAgent(GROK_4_3_MODEL)

    expectPromptIncludes(agent.prompt, SISYPHUS_OPERATION_CRITERIA)
  })

  test("#given supported Grok model #when Sisyphus prompt is built #then Grok execution guardrails are applied", () => {
    const agent = createSisyphusAgent(GROK_BUILD_MODEL)

    expect(agent.prompt).toContain("based on Grok")
    expectPromptIncludes(agent.prompt, GROK_OPERATION_CRITERIA)
  })

  test("#given adjacent Grok versions #when Sisyphus is created #then only supported Grok variants use the harness", () => {
    const grok43Variant = createSisyphusAgent("xai/grok-4.3-fast")
    const grokBuild = createSisyphusAgent(GROK_BUILD_MODEL)
    const grokBuildDot = createSisyphusAgent("xai/grok-build.0.1")
    const grok430 = createSisyphusAgent("xai/grok-4.30")
    const grok42 = createSisyphusAgent("xai/grok-4.2")
    const grokBuild010 = createSisyphusAgent("xai/grok-build-0.10")

    expect(grok43Variant.prompt).toContain("Grok Harness Overlay")
    expect(grokBuild.prompt).toContain("Grok Harness Overlay")
    expect(grokBuildDot.prompt).toContain("Grok Harness Overlay")
    expect(grok430.prompt).not.toContain("Grok Harness Overlay")
    expect(grok42.prompt).not.toContain("Grok Harness Overlay")
    expect(grokBuild010.prompt).not.toContain("Grok Harness Overlay")
  })
})
