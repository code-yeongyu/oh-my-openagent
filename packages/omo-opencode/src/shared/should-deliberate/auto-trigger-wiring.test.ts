import { describe, test, expect } from "bun:test"

import { createSisyphusAgent } from "../../agents/sisyphus/agent"
import { createAtlasAgent } from "../../agents/atlas/agent"
import { shouldDeliberate } from "./heuristic"

const TEST_MODEL = "anthropic/claude-sonnet-4-6"
const SECTION_ANCHOR = "Themis Auto-Routing"

describe("Themis auto-trigger wiring", () => {
  describe("#given Sisyphus agent", () => {
    test("#when themisAutoTrigger defaults to true #then Themis routing section is in the prompt", () => {
      const agent = createSisyphusAgent(TEST_MODEL)
      expect(agent.prompt).toContain(SECTION_ANCHOR)
    })

    test("#when themisAutoTrigger=false #then Themis routing section is absent", () => {
      const agent = createSisyphusAgent(TEST_MODEL, [], [], [], [], false, false)
      expect(agent.prompt).not.toContain(SECTION_ANCHOR)
    })
  })

  describe("#given Atlas agent", () => {
    test("#when themisAutoTrigger defaults to true #then Themis routing section is in the prompt", () => {
      const agent = createAtlasAgent({ model: TEST_MODEL })
      expect(agent.prompt).toContain(SECTION_ANCHOR)
    })

    test("#when themisAutoTrigger=false #then Themis routing section is absent", () => {
      const agent = createAtlasAgent({ model: TEST_MODEL, themisAutoTrigger: false })
      expect(agent.prompt).not.toContain(SECTION_ANCHOR)
    })
  })

  describe("#given shouldDeliberate helper #when invoked alongside agent creation", () => {
    test("#when competing-options message #then heuristic agrees with prompt-section trigger criteria", () => {
      const result = shouldDeliberate("Should we pick Postgres vs MySQL for sessions?")
      expect(result.trigger).toBe(true)
      const agent = createSisyphusAgent(TEST_MODEL)
      expect(agent.prompt).toContain("vs")
      expect(agent.prompt).toContain("versus")
    })

    test("#when implementation request #then heuristic does NOT trigger", () => {
      const result = shouldDeliberate("Add a dark mode toggle to settings")
      expect(result.trigger).toBe(false)
    })
  })
})
