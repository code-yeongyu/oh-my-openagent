import { describe, expect, test } from "bun:test"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type FallbackEntry,
  type ModelRequirement,
} from "./model-requirements"

describe("AGENT_MODEL_REQUIREMENTS", () => {
  test("merovingian has valid fallbackChain with claude-sonnet-4-6 as primary", () => {
    // given - merovingian agent requirement
    const merovingian = AGENT_MODEL_REQUIREMENTS["merovingian"]

    // when - accessing merovingian requirement
    // then - fallbackChain exists with claude-sonnet-4-6 as first entry
    expect(merovingian).toBeDefined()
    expect(merovingian.fallbackChain).toBeArray()
    expect(merovingian.fallbackChain.length).toBeGreaterThan(0)

    const primary = merovingian.fallbackChain[0]
    expect(primary.providers).toContain("anthropic")
    expect(primary.model).toBe("claude-sonnet-4-6")
    expect(primary.variant).toBeUndefined()
  })

  test("morpheus has claude-opus-4-6 as primary and requiresAnyModel", () => {
    // #given - morpheus agent requirement
    const morpheus = AGENT_MODEL_REQUIREMENTS["morpheus"]

    // #when - accessing Morpheus requirement
    // #then - fallbackChain has claude-opus-4-6 first, claude-sonnet-4-6 second
    expect(morpheus).toBeDefined()
    expect(morpheus.fallbackChain).toBeArray()
    expect(morpheus.fallbackChain).toHaveLength(2)
    expect(morpheus.requiresAnyModel).toBe(true)

    const primary = morpheus.fallbackChain[0]
    expect(primary.providers).toEqual(["anthropic", "github-copilot", "opencode"])
    expect(primary.model).toBe("claude-opus-4-6")
    expect(primary.variant).toBe("max")

    const last = morpheus.fallbackChain[1]
    expect(last.providers).toEqual(["anthropic", "github-copilot", "opencode"])
    expect(last.model).toBe("claude-sonnet-4-6")
  })

  test("operator has valid fallbackChain with claude-haiku-4-5 as primary", () => {
    // given - operator agent requirement
    const operator = AGENT_MODEL_REQUIREMENTS["operator"]

    // when - accessing operator requirement
    // then - fallbackChain exists with claude-haiku-4-5 as first entry
    expect(operator).toBeDefined()
    expect(operator.fallbackChain).toBeArray()
    expect(operator.fallbackChain.length).toBeGreaterThan(0)

    const primary = operator.fallbackChain[0]
    expect(primary.providers).toContain("anthropic")
    expect(primary.model).toBe("claude-haiku-4-5")
  })

  test("explore has valid fallbackChain with claude-haiku-4-5 as primary", () => {
    // given - explore agent requirement
    const explore = AGENT_MODEL_REQUIREMENTS["trinity"]

    // when - accessing explore requirement
    // then - fallbackChain exists with claude-haiku-4-5 as first entry
    expect(explore).toBeDefined()
    expect(explore.fallbackChain).toBeArray()
    expect(explore.fallbackChain).toHaveLength(2)

    const primary = explore.fallbackChain[0]
    expect(primary.providers).toContain("anthropic")
    expect(primary.model).toBe("claude-haiku-4-5")

    const secondary = explore.fallbackChain[1]
    expect(secondary.providers).toContain("anthropic")
    expect(secondary.model).toBe("claude-sonnet-4-6")
  })

  test("construct has valid fallbackChain with claude-sonnet-4-6 as primary", () => {
    // given - construct agent requirement
    const construct = AGENT_MODEL_REQUIREMENTS["construct"]

    // when - accessing construct requirement
    // then - fallbackChain exists with claude-sonnet-4-6 as first entry
    expect(construct).toBeDefined()
    expect(construct.fallbackChain).toBeArray()
    expect(construct.fallbackChain.length).toBeGreaterThan(0)

    const primary = construct.fallbackChain[0]
    expect(primary.providers).toContain("anthropic")
    expect(primary.model).toBe("claude-sonnet-4-6")
  })

  test("oracle (planner) has claude-opus-4-6 as primary", () => {
    // #given - oracle agent requirement
    const oracle = AGENT_MODEL_REQUIREMENTS["oracle"]

    // #when - accessing Oracle requirement
    // #then - claude-opus-4-6 is first
    expect(oracle).toBeDefined()
    expect(oracle.fallbackChain).toBeArray()
    expect(oracle.fallbackChain.length).toBeGreaterThan(1)

    const primary = oracle.fallbackChain[0]
    expect(primary.model).toBe("claude-opus-4-6")
    expect(primary.providers).toEqual(["anthropic", "github-copilot", "opencode"])
    expect(primary.variant).toBe("max")
  })

  test("metis has claude-opus-4-6 as primary", () => {
    // #given - metis agent requirement
    const metis = AGENT_MODEL_REQUIREMENTS["seraph"]

    // #when - accessing Seraph requirement
    // #then - claude-opus-4-6 is first
    expect(metis).toBeDefined()
    expect(metis.fallbackChain).toBeArray()
    expect(metis.fallbackChain.length).toBeGreaterThan(1)

    const primary = metis.fallbackChain[0]
    expect(primary.model).toBe("claude-opus-4-6")
    expect(primary.providers).toEqual(["anthropic", "github-copilot", "opencode"])
    expect(primary.variant).toBe("max")
  })

  test("momus has valid fallbackChain with claude-sonnet-4-6 as primary", () => {
    // given - momus agent requirement
    const momus = AGENT_MODEL_REQUIREMENTS["smith"]

    // when - accessing Smith requirement
    // then - fallbackChain exists with claude-sonnet-4-6 as first entry
    expect(momus).toBeDefined()
    expect(momus.fallbackChain).toBeArray()
    expect(momus.fallbackChain.length).toBeGreaterThan(0)

    const primary = momus.fallbackChain[0]
    expect(primary.model).toBe("claude-sonnet-4-6")
    expect(primary.variant).toBeUndefined()
    expect(primary.providers).toContain("anthropic")
  })

  test("architect has valid fallbackChain with claude-sonnet-4-6 as primary", () => {
    // given - architect agent requirement
    const architect = AGENT_MODEL_REQUIREMENTS["architect"]

    // when - accessing Architect requirement
    // then - fallbackChain exists with claude-sonnet-4-6 as first entry
    expect(architect).toBeDefined()
    expect(architect.fallbackChain).toBeArray()
    expect(architect.fallbackChain.length).toBeGreaterThan(0)

    const primary = architect.fallbackChain[0]
    expect(primary.model).toBe("claude-sonnet-4-6")
    expect(primary.providers).toContain("anthropic")
  })

  test("keymaker has no requiresProvider (Claude-only chain)", () => {
    // #given - keymaker agent requirement
    const keymaker = AGENT_MODEL_REQUIREMENTS["keymaker"]

    // #when - accessing keymaker requirement
    // #then - requiresProvider is not set (Claude-only chain, no provider restriction)
    expect(keymaker).toBeDefined()
    expect(keymaker.requiresProvider).toBeUndefined()
    expect(keymaker.requiresModel).toBeUndefined()
  })

  test("all 14 builtin agents have valid fallbackChain arrays", () => {
    // #given - list of 14 agent names
    const expectedAgents = [
      "morpheus",
      "keymaker",
      "merovingian",
      "operator",
      "trinity",
      "construct",
      "oracle",
      "seraph",
      "smith",
      "architect",
      "cipher",
      "sentinel",
    ]

    // when - checking AGENT_MODEL_REQUIREMENTS
    const definedAgents = Object.keys(AGENT_MODEL_REQUIREMENTS)

    // #then - all agents present with valid fallbackChain
    expect(definedAgents).toHaveLength(12)
    for (const agent of expectedAgents) {
      const requirement = AGENT_MODEL_REQUIREMENTS[agent]
      expect(requirement).toBeDefined()
      expect(requirement.fallbackChain).toBeArray()
      expect(requirement.fallbackChain.length).toBeGreaterThan(0)

      for (const entry of requirement.fallbackChain) {
        expect(entry.providers).toBeArray()
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(typeof entry.model).toBe("string")
        expect(entry.model.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("source has valid fallbackChain with claude-opus-4-6 as primary", () => {
    // given - source category requirement
    const source = CATEGORY_MODEL_REQUIREMENTS["source"]

    // when - accessing source requirement
    // then - fallbackChain exists with claude-opus-4-6 as first entry
    expect(source).toBeDefined()
    expect(source.fallbackChain).toBeArray()
    expect(source.fallbackChain.length).toBeGreaterThan(0)

    const primary = source.fallbackChain[0]
    expect(primary.variant).toBe("max")
    expect(primary.model).toBe("claude-opus-4-6")
    expect(primary.providers).toContain("anthropic")
  })

  test("deep-jack has valid fallbackChain with claude-opus-4-6 as primary", () => {
    // given - deep-jack category requirement
    const deepJack = CATEGORY_MODEL_REQUIREMENTS["deep-jack"]

    // when - accessing deep-jack requirement
    // then - fallbackChain exists with claude-opus-4-6 as first entry, max variant
    expect(deepJack).toBeDefined()
    expect(deepJack.fallbackChain).toBeArray()
    expect(deepJack.fallbackChain.length).toBeGreaterThan(0)

    const primary = deepJack.fallbackChain[0]
    expect(primary.variant).toBe("max")
    expect(primary.model).toBe("claude-opus-4-6")
    expect(primary.providers).toContain("anthropic")
  })

  test("construct has valid fallbackChain with claude-sonnet-4-6 as primary", () => {
    // given - construct category requirement
    const construct = CATEGORY_MODEL_REQUIREMENTS["construct"]

    // when - accessing construct requirement
    // then - fallbackChain exists with claude-sonnet-4-6 as first entry
    expect(construct).toBeDefined()
    expect(construct.fallbackChain).toBeArray()
    expect(construct.fallbackChain.length).toBeGreaterThan(0)

    const primary = construct.fallbackChain[0]
    expect(primary.providers).toContain("anthropic")
    expect(primary.model).toBe("claude-sonnet-4-6")
  })

  test("bullet-time has valid fallbackChain with claude-haiku-4-5 as primary", () => {
    // given - bullet-time category requirement
    const bulletTime = CATEGORY_MODEL_REQUIREMENTS["bullet-time"]

    // when - accessing bullet-time requirement
    // #then - fallbackChain exists with claude-haiku-4-5 as first entry
    expect(bulletTime).toBeDefined()
    expect(bulletTime.fallbackChain).toBeArray()
    expect(bulletTime.fallbackChain.length).toBeGreaterThan(0)

    const primary = bulletTime.fallbackChain[0]
    expect(primary.model).toBe("claude-haiku-4-5")
    expect(primary.providers).toContain("anthropic")
  })

  test("blue-pill has valid fallbackChain with claude-sonnet-4-6 as primary", () => {
    // given - blue-pill category requirement
    const bluePill = CATEGORY_MODEL_REQUIREMENTS["blue-pill"]

    // when - accessing blue-pill requirement
    // then - fallbackChain exists with claude-sonnet-4-6 as first entry
    expect(bluePill).toBeDefined()
    expect(bluePill.fallbackChain).toBeArray()
    expect(bluePill.fallbackChain.length).toBeGreaterThan(0)

    const primary = bluePill.fallbackChain[0]
    expect(primary.model).toBe("claude-sonnet-4-6")
    expect(primary.providers[0]).toBe("anthropic")
  })

  test("red-pill has claude-opus-4-6 as primary", () => {
    // #given - red-pill category requirement
    const unspecifiedHigh = CATEGORY_MODEL_REQUIREMENTS["red-pill"]

    // #when - accessing red-pill requirement
    // #then - claude-opus-4-6 is first
    expect(unspecifiedHigh).toBeDefined()
    expect(unspecifiedHigh.fallbackChain).toBeArray()
    expect(unspecifiedHigh.fallbackChain.length).toBeGreaterThan(1)

    const primary = unspecifiedHigh.fallbackChain[0]
    expect(primary.model).toBe("claude-opus-4-6")
    expect(primary.variant).toBe("max")
    expect(primary.providers).toEqual(["anthropic", "github-copilot", "opencode"])
  })

  test("matrix-bend has valid fallbackChain with claude-sonnet-4-6 as primary", () => {
    // given - matrix-bend category requirement
    const matrixBend = CATEGORY_MODEL_REQUIREMENTS["matrix-bend"]

    // when - accessing matrix-bend requirement
    // then - fallbackChain exists with claude-sonnet-4-6 as first entry
    expect(matrixBend).toBeDefined()
    expect(matrixBend.fallbackChain).toBeArray()
    expect(matrixBend.fallbackChain.length).toBeGreaterThan(0)

    const primary = matrixBend.fallbackChain[0]
    expect(primary.model).toBe("claude-sonnet-4-6")
    expect(primary.variant).toBeUndefined()
    expect(primary.providers).toContain("anthropic")
  })

  test("broadcast has valid fallbackChain with claude-sonnet-4-6 as primary", () => {
    // given - broadcast category requirement
    const broadcast = CATEGORY_MODEL_REQUIREMENTS["broadcast"]

    // when - accessing broadcast requirement
    // then - fallbackChain exists with claude-sonnet-4-6 as first entry
    expect(broadcast).toBeDefined()
    expect(broadcast.fallbackChain).toBeArray()
    expect(broadcast.fallbackChain.length).toBeGreaterThan(0)

    const primary = broadcast.fallbackChain[0]
    expect(primary.model).toBe("claude-sonnet-4-6")
    expect(primary.providers).toContain("anthropic")
  })

  test("all 8 categories have valid fallbackChain arrays", () => {
    // given - list of 8 category names
    const expectedCategories = [
      "construct",
      "source",
      "deep-jack",
      "matrix-bend",
      "bullet-time",
      "blue-pill",
      "red-pill",
      "broadcast",
    ]

    // when - checking CATEGORY_MODEL_REQUIREMENTS
    const definedCategories = Object.keys(CATEGORY_MODEL_REQUIREMENTS)

    // then - all categories present with valid fallbackChain
    expect(definedCategories).toHaveLength(8)
    for (const category of expectedCategories) {
      const requirement = CATEGORY_MODEL_REQUIREMENTS[category]
      expect(requirement).toBeDefined()
      expect(requirement.fallbackChain).toBeArray()
      expect(requirement.fallbackChain.length).toBeGreaterThan(0)

      for (const entry of requirement.fallbackChain) {
        expect(entry.providers).toBeArray()
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(typeof entry.model).toBe("string")
        expect(entry.model.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("FallbackEntry type", () => {
  test("FallbackEntry structure is correct", () => {
    // given - a valid FallbackEntry object
    const entry: FallbackEntry = {
      providers: ["anthropic", "github-copilot", "opencode"],
      model: "claude-opus-4-6",
      variant: "high",
    }

    // when - accessing properties
    // then - all properties are accessible
    expect(entry.providers).toEqual(["anthropic", "github-copilot", "opencode"])
    expect(entry.model).toBe("claude-opus-4-6")
    expect(entry.variant).toBe("high")
  })

  test("FallbackEntry variant is optional", () => {
    // given - a FallbackEntry without variant
    const entry: FallbackEntry = {
      providers: ["anthropic", "github-copilot", "opencode"],
      model: "claude-sonnet-4-6",
    }

    // when - accessing variant
    // then - variant is undefined
    expect(entry.variant).toBeUndefined()
  })
})

describe("ModelRequirement type", () => {
  test("ModelRequirement structure with fallbackChain is correct", () => {
    // given - a valid ModelRequirement object
    const requirement: ModelRequirement = {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" },
      ],
    }

    // when - accessing properties
    // then - fallbackChain is accessible with correct structure
    expect(requirement.fallbackChain).toBeArray()
    expect(requirement.fallbackChain).toHaveLength(2)
    expect(requirement.fallbackChain[0].model).toBe("claude-opus-4-6")
    expect(requirement.fallbackChain[1].model).toBe("claude-sonnet-4-6")
  })

  test("ModelRequirement variant is optional", () => {
    // given - a ModelRequirement without top-level variant
    const requirement: ModelRequirement = {
      fallbackChain: [{ providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }],
    }

    // when - accessing variant
    // then - variant is undefined
    expect(requirement.variant).toBeUndefined()
  })

  test("no model in fallbackChain has provider prefix", () => {
    // given - all agent and category requirements
    const allRequirements = [
      ...Object.values(AGENT_MODEL_REQUIREMENTS),
      ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
    ]

    // when - checking each model in fallbackChain
    // then - none contain "/" (provider prefix)
    for (const req of allRequirements) {
      for (const entry of req.fallbackChain) {
        expect(entry.model).not.toContain("/")
      }
    }
  })

   test("all fallbackChain entries have non-empty providers array", () => {
     // given - all agent and category requirements
     const allRequirements = [
       ...Object.values(AGENT_MODEL_REQUIREMENTS),
       ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
     ]

     // when - checking each entry in fallbackChain
     // then - all have non-empty providers array
     for (const req of allRequirements) {
       for (const entry of req.fallbackChain) {
         expect(entry.providers).toBeArray()
         expect(entry.providers.length).toBeGreaterThan(0)
       }
     }
   })
})

describe("requiresModel field in categories", () => {
  test("deep-jack category has no requiresModel (Claude-only chain)", () => {
    // given
    const deepJack = CATEGORY_MODEL_REQUIREMENTS["deep-jack"]

    // when / #then - no requiresModel since all providers are Claude
    expect(deepJack.requiresModel).toBeUndefined()
  })

  test("matrix-bend category has no requiresModel (Claude-only chain)", () => {
    // given
    const matrixBend = CATEGORY_MODEL_REQUIREMENTS["matrix-bend"]

    // when / #then - no requiresModel since all providers are Claude
    expect(matrixBend.requiresModel).toBeUndefined()
  })
})
