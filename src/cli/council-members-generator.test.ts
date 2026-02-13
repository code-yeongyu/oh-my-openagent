import { describe, test, expect } from "bun:test"
import { generateCouncilMembers } from "./council-members-generator"
import type { ProviderAvailability } from "./model-fallback-types"

function makeAvail(overrides: {
  native?: Partial<ProviderAvailability["native"]>
  opencodeZen?: boolean
  copilot?: boolean
  zai?: boolean
  kimiForCoding?: boolean
  isMaxPlan?: boolean
}): ProviderAvailability {
  return {
    native: {
      claude: false,
      openai: false,
      gemini: false,
      ...(overrides.native ?? {}),
    },
    opencodeZen: overrides.opencodeZen ?? false,
    copilot: overrides.copilot ?? false,
    zai: overrides.zai ?? false,
    kimiForCoding: overrides.kimiForCoding ?? false,
    isMaxPlan: overrides.isMaxPlan ?? false,
  }
}

describe("generateCouncilMembers", () => {
  //#given all three native providers
  //#when generating council members
  //#then returns 3 members (one per provider)
  test("returns 3 members when claude + openai + gemini available", () => {
    const members = generateCouncilMembers(makeAvail({
      native: { claude: true, openai: true, gemini: true },
    }))

    expect(members).toHaveLength(3)
    expect(members.some(m => m.model.startsWith("anthropic/"))).toBe(true)
    expect(members.some(m => m.model.startsWith("openai/"))).toBe(true)
    expect(members.some(m => m.model.startsWith("google/"))).toBe(true)
    expect(members.every(m => m.name)).toBe(true)
  })

  //#given claude + openai only
  //#when generating council members
  //#then returns 2 members
  test("returns 2 members when claude + openai available", () => {
    const members = generateCouncilMembers(makeAvail({
      native: { claude: true, openai: true },
    }))

    expect(members).toHaveLength(2)
    expect(members.some(m => m.model.startsWith("anthropic/"))).toBe(true)
    expect(members.some(m => m.model.startsWith("openai/"))).toBe(true)
  })

  //#given claude + gemini only
  //#when generating council members
  //#then returns 2 members
  test("returns 2 members when claude + gemini available", () => {
    const members = generateCouncilMembers(makeAvail({
      native: { claude: true, gemini: true },
    }))

    expect(members).toHaveLength(2)
  })

  //#given openai + gemini only
  //#when generating council members
  //#then returns 2 members
  test("returns 2 members when openai + gemini available", () => {
    const members = generateCouncilMembers(makeAvail({
      native: { openai: true, gemini: true },
    }))

    expect(members).toHaveLength(2)
  })

  //#given only one native provider
  //#when copilot is also available
  //#then returns 2 members (native + copilot)
  test("uses copilot as second member when only one native provider", () => {
    const members = generateCouncilMembers(makeAvail({
      native: { claude: true },
      copilot: true,
    }))

    expect(members.length).toBeGreaterThanOrEqual(2)
  })

  //#given only one native provider
  //#when opencode zen is also available
  //#then returns 2 members
  test("uses opencode zen as second member when only one native provider", () => {
    const members = generateCouncilMembers(makeAvail({
      native: { gemini: true },
      opencodeZen: true,
    }))

    expect(members.length).toBeGreaterThanOrEqual(2)
  })

  //#given no providers at all
  //#when generating council members
  //#then returns empty array (can't meet minimum 2)
  test("returns empty when no providers available", () => {
    const members = generateCouncilMembers(makeAvail({}))

    expect(members).toHaveLength(0)
  })

  //#given only one provider, no fallbacks
  //#when generating council members
  //#then returns empty (need at least 2 distinct models)
  test("returns empty when only one provider and no fallbacks", () => {
    const members = generateCouncilMembers(makeAvail({
      native: { claude: true },
    }))

    expect(members).toHaveLength(0)
  })

  //#given all members have names
  //#when generating council
  //#then each member has a human-readable name
  test("all members have name field", () => {
    const members = generateCouncilMembers(makeAvail({
      native: { claude: true, openai: true, gemini: true },
    }))

    for (const m of members) {
      expect(m.name).toBeDefined()
      expect(typeof m.name).toBe("string")
      expect(m.name!.length).toBeGreaterThan(0)
    }
  })
})
