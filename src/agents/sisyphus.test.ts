import { describe, expect, test } from "bun:test"
import { createSisyphusAgent } from "./sisyphus"

describe("createSisyphusAgent prompt variants", () => {
  test("uses compact prompt for codex models but keeps delegation", () => {
    // #given
    const agent = createSisyphusAgent("openai/gpt-5.2-codex")

    // #then
    expect(agent.prompt).toContain("## Codex Execution Profile")
    expect(agent.prompt).not.toContain("## Phase 0 - Intent Gate")
    expect(agent.prompt).not.toContain("## Phase 1 - Codebase Assessment")
    expect(agent.prompt).toContain("### Delegation Table:")
    expect(agent.prompt).toContain("### Delegation Prompt Structure")
  })

  test("uses full prompt for non-codex models", () => {
    // #given
    const agent = createSisyphusAgent("anthropic/claude-opus-4-5")

    // #then
    expect(agent.prompt).toContain("| Type | Signal | Action |")
    expect(agent.prompt).toContain("### Workflow (NON-NEGOTIABLE)")
  })
})
