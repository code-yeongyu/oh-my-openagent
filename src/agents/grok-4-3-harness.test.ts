import { describe, expect, test } from "bun:test"
import { createSisyphusAgent } from "./sisyphus"

const GROK_4_3_MODEL = "xai/grok-4.3"
const GPT_5_5_MODEL = "openai/gpt-5.5"

const GPT_5_5_BASELINE_CRITERIA = [
  "delegating well",
  "Manual QA Gate",
  "Parallelize aggressively",
  "task(category=",
  "lsp_diagnostics",
  "run_in_background=true",
  "Do not stop at analysis",
]

const ACTION_BY_DEFAULT_CRITERIA = [
  "Act without asking when the next useful step is reasonably inferable",
  "Do not ask permission questions",
  "choose the safest useful default and execute",
  "Never ask a permission question when a safe next action exists",
]

const GROK_4_3_EXTRA_GUARDRAILS = [
  "GPT-5.5 parity target",
  "Hook-triggered workflow modes are execution triggers",
  "include at least one real tool call in the same assistant response",
  "OMO features are first-class tools",
  "Codebase mapping before edits",
]

function missingCriteria(prompt: string, criteria: readonly string[]): string[] {
  return criteria.filter((criterion) => !prompt.includes(criterion))
}

describe("Grok 4.3 harness routing", () => {
  test("#given Grok 4.3 #when Sisyphus is created #then it uses dedicated Grok harness settings", () => {
    const agent = createSisyphusAgent(GROK_4_3_MODEL)

    expect(agent.reasoningEffort).toBe("medium")
    expect(agent.permission).toHaveProperty("apply_patch", "deny")
    expect(agent.prompt).toContain("based on Grok-4.3")
  })

  test("#given adjacent Grok versions #when Sisyphus is created #then only Grok 4.3 uses the harness", () => {
    const grok43Variant = createSisyphusAgent("xai/grok-4.3-fast")
    const grok430 = createSisyphusAgent("xai/grok-4.30")
    const grok42 = createSisyphusAgent("xai/grok-4.2")

    expect(grok43Variant.prompt).toContain("Grok-4.3 Harness Overlay")
    expect(grok430.prompt).not.toContain("Grok-4.3 Harness Overlay")
    expect(grok42.prompt).not.toContain("Grok-4.3 Harness Overlay")
  })

  test("#given Grok 4.3 #when Sisyphus prompt is built #then hook-triggered ultrawork requires same-response tool execution", () => {
    const agent = createSisyphusAgent(GROK_4_3_MODEL)

    expect(agent.prompt).toContain("Hook-triggered workflow modes are execution triggers")
    expect(agent.prompt).toContain("ulw ulw")
    expect(agent.prompt).toContain("include at least one real tool call in the same assistant response")
  })

  test("#given Grok 4.3 #when Sisyphus prompt is built #then OMO feature usage is explicit", () => {
    const agent = createSisyphusAgent(GROK_4_3_MODEL)

    expect(agent.prompt).toContain("OMO features are first-class tools")
    expect(agent.prompt).toContain("skill_mcp")
    expect(agent.prompt).toContain("session_search")
    expect(agent.prompt).toContain("Default to using the feature")
  })

  test("#given Grok 4.3 #when Sisyphus prompt is built #then codebase mapping before edits is explicit", () => {
    const agent = createSisyphusAgent(GROK_4_3_MODEL)

    expect(agent.prompt).toContain("Codebase mapping before edits")
    expect(agent.prompt).toContain("Direct callers, importers, dependents, or call chains")
    expect(agent.prompt).toContain("rg --files")
    expect(agent.prompt).toContain("ast_grep_search")
    expect(agent.prompt).toContain("Skip the mapping pass for typos")
  })

  test("#given GPT 5.5 baseline criteria #when Grok 4.3 prompt is compared #then it preserves Sisyphus work obligations", () => {
    const gptAgent = createSisyphusAgent(GPT_5_5_MODEL)
    const grokAgent = createSisyphusAgent(GROK_4_3_MODEL)

    expect(missingCriteria(gptAgent.prompt, GPT_5_5_BASELINE_CRITERIA)).toEqual([])
    expect(missingCriteria(grokAgent.prompt, GPT_5_5_BASELINE_CRITERIA)).toEqual([])
    expect(grokAgent.maxTokens).toBe(gptAgent.maxTokens)
    expect(grokAgent.reasoningEffort).toBe(gptAgent.reasoningEffort)
  })

  test("#given Sisyphus prompts #when a safe next action exists #then they prohibit permission questions", () => {
    const grokAgent = createSisyphusAgent(GROK_4_3_MODEL)

    expect(missingCriteria(grokAgent.prompt, ACTION_BY_DEFAULT_CRITERIA)).toEqual([])
    expect(grokAgent.prompt).toContain("Should I proceed?")
    expect(grokAgent.prompt).toContain("docs/docs-index.json")
  })

  test("#given Grok 4.3 known stall modes #when compared with GPT 5.5 #then it adds only stricter execution guardrails", () => {
    const gptAgent = createSisyphusAgent(GPT_5_5_MODEL)
    const grokAgent = createSisyphusAgent(GROK_4_3_MODEL)

    expect(missingCriteria(grokAgent.prompt, GROK_4_3_EXTRA_GUARDRAILS)).toEqual([])
    expect(gptAgent.prompt).not.toContain("GPT-5.5 parity target")
    expect(gptAgent.prompt).not.toContain("Hook-triggered workflow modes are execution triggers")
  })
})
