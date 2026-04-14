import { describe, expect, test } from "bun:test"
import { createSisyphusAgent } from "./sisyphus"
import { createHephaestusAgent } from "./hephaestus"
import { buildSisyphusJuniorPrompt } from "./sisyphus-junior/agent"
import {
  buildAntiDuplicationSection,
  buildExploreSection,
  type AvailableAgent,
} from "./dynamic-agent-prompt-builder"

const exploreAgent = {
  name: "explore",
  description: "Contextual grep specialist",
  metadata: {
    category: "advisor",
    cost: "FREE",
    promptAlias: "Explore",
    triggers: [],
    useWhen: ["Multiple search angles needed"],
    avoidWhen: ["Single keyword search is enough"],
  },
} satisfies AvailableAgent

describe("delegation trust prompt rules", () => {
  test("buildAntiDuplicationSection explains overlap is forbidden", () => {
    // given
    const section = buildAntiDuplicationSection()

    // when / then
    expect(section).toContain("DO NOT perform the same search yourself")
    expect(section).toContain("non-overlapping work")
    expect(section).toContain("End your response")
  })

  test("buildExploreSection includes delegation trust rule", () => {
    // given
    const agents = [exploreAgent]

    // when
    const section = buildExploreSection(agents)

    // then
    expect(section).toContain("Delegation Trust Rule")
    expect(section).toContain("do **not** manually perform that same search yourself")
  })

  test("Sisyphus prompt forbids duplicate delegated exploration", () => {
    // given
    const agent = createSisyphusAgent("anthropic/claude-sonnet-4-6", [exploreAgent])

    // when
    const prompt = agent.prompt

    // then
    expect(prompt).toContain("Continue only with non-overlapping work")
    expect(prompt).toContain("DO NOT perform the same search yourself")
  })

  test("Hephaestus prompt forbids duplicate delegated exploration", () => {
    // given
    const agent = createHephaestusAgent("openai/gpt-5.2", [exploreAgent])

    // when
    const prompt = agent.prompt

    // then
    expect(prompt).toContain("Continue only with non-overlapping work after launching background agents")
    expect(prompt).toContain("DO NOT perform the same search yourself")
  })

  test("Hephaestus GPT-5.4 prompt forbids duplicate delegated exploration", () => {
    // given
    const agent = createHephaestusAgent("openai/gpt-5.4", [exploreAgent])

    // when
    const prompt = agent.prompt

    // then
    expect(prompt).toContain("continue only with non-overlapping work while they search")
    expect(prompt).toContain("Continue only with non-overlapping work after launching background agents")
    expect(prompt).toContain("DO NOT perform the same search yourself")
  })

  test("Hephaestus GPT-5.3 Codex prompt forbids duplicate delegated exploration", () => {
    // given
    const agent = createHephaestusAgent("openai/gpt-5.3-codex", [exploreAgent])

    // when
    const prompt = agent.prompt

    // then
    expect(prompt).toContain("continue only with non-overlapping work while they search")
    expect(prompt).toContain("Continue only with non-overlapping work after launching background agents")
    expect(prompt).toContain("DO NOT perform the same search yourself")
  })

  test("Sisyphus-Junior GPT prompt forbids duplicate delegated exploration", () => {
    // given
    const prompt = buildSisyphusJuniorPrompt("openai/gpt-5.2", false)

    // when / then
    expect(prompt).toContain("continue only with non-overlapping work while they search")
    expect(prompt).toContain("DO NOT perform the same search yourself")
  })

  test("Sisyphus GPT-5.4 prompt forbids duplicate delegated exploration", () => {
    // given
    const agent = createSisyphusAgent("openai/gpt-5.4", [exploreAgent])

    // when
    const prompt = agent.prompt

    // then
    expect(prompt).toContain("do only non-overlapping work simultaneously")
    expect(prompt).toContain("Continue only with non-overlapping work")
    expect(prompt).toContain("DO NOT perform the same search yourself")
    expect(prompt).toContain("Do not use `apply_patch`")
    expect(prompt).toContain("`edit` and `write`")
  })

  test("Sisyphus-Junior GPT-5.4 prompt forbids duplicate delegated exploration", () => {
    // given
    const prompt = buildSisyphusJuniorPrompt("openai/gpt-5.4", false)

    // when / then
    expect(prompt).toContain("continue only with non-overlapping work while they search")
    expect(prompt).toContain("DO NOT perform the same search yourself")
  })

  test("Sisyphus-Junior GPT-5.3 Codex prompt forbids duplicate delegated exploration", () => {
    // given
    const prompt = buildSisyphusJuniorPrompt("openai/gpt-5.3-codex", false)

    // when / then
    expect(prompt).toContain("continue only with non-overlapping work while they search")
    expect(prompt).toContain("DO NOT perform the same search yourself")
  })

  test("Sisyphus-Junior Gemini prompt forbids duplicate delegated exploration", () => {
    // given
    const prompt = buildSisyphusJuniorPrompt("google/gemini-3.1-pro", false)

    // when / then
    expect(prompt).toContain("continue only with non-overlapping work while they search")
    expect(prompt).toContain("DO NOT perform the same search yourself")
  })
})
