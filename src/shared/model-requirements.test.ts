import { describe, expect, test } from "bun:test"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type FallbackEntry,
  type ModelRequirement,
} from "./model-requirements"

describe("AGENT_MODEL_REQUIREMENTS", () => {
  test("merovingian has valid fallbackChain with gpt-5.2 as primary", () => {
    // given - merovingian agent requirement
    const merovingian = AGENT_MODEL_REQUIREMENTS["merovingian"]

    // when - accessing merovingian requirement
    // then - fallbackChain exists with gpt-5.2 as first entry
    expect(merovingian).toBeDefined()
    expect(merovingian.fallbackChain).toBeArray()
    expect(merovingian.fallbackChain.length).toBeGreaterThan(0)

    const primary = merovingian.fallbackChain[0]
    expect(primary.providers).toContain("openai")
    expect(primary.model).toBe("gpt-5.2")
    expect(primary.variant).toBe("high")
  })

  test("morpheus has claude-opus-4-6 as primary and requiresAnyModel", () => {
    // #given - morpheus agent requirement
    const morpheus = AGENT_MODEL_REQUIREMENTS["morpheus"]

    // #when - accessing Morpheus requirement
    // #then - fallbackChain has claude-opus-4-6 first, glm-4.7-free last
    expect(morpheus).toBeDefined()
    expect(morpheus.fallbackChain).toBeArray()
    expect(morpheus.fallbackChain).toHaveLength(4)
    expect(morpheus.requiresAnyModel).toBe(true)

    const primary = morpheus.fallbackChain[0]
    expect(primary.providers).toEqual(["anthropic", "github-copilot", "opencode"])
    expect(primary.model).toBe("claude-opus-4-6")
    expect(primary.variant).toBe("max")

    const last = morpheus.fallbackChain[3]
    expect(last.providers[0]).toBe("opencode")
    expect(last.model).toBe("big-pickle")
  })

  test("librarian has valid fallbackChain with glm-4.7 as primary", () => {
    // given - librarian agent requirement
    const librarian = AGENT_MODEL_REQUIREMENTS["operator"]

    // when - accessing librarian requirement
    // then - fallbackChain exists with glm-4.7 as first entry
    expect(librarian).toBeDefined()
    expect(librarian.fallbackChain).toBeArray()
    expect(librarian.fallbackChain.length).toBeGreaterThan(0)

    const primary = librarian.fallbackChain[0]
    expect(primary.providers[0]).toBe("zai-coding-plan")
    expect(primary.model).toBe("glm-4.7")
  })

  test("explore has valid fallbackChain with grok-code-fast-1 as primary", () => {
    // given - explore agent requirement
    const explore = AGENT_MODEL_REQUIREMENTS["trinity"]

    // when - accessing explore requirement
    // then - fallbackChain exists with grok-code-fast-1 as first entry, claude-haiku-4-5 as second
    expect(explore).toBeDefined()
    expect(explore.fallbackChain).toBeArray()
    expect(explore.fallbackChain).toHaveLength(4)

    const primary = explore.fallbackChain[0]
    expect(primary.providers).toContain("github-copilot")
    expect(primary.model).toBe("grok-code-fast-1")

    const secondary = explore.fallbackChain[1]
    expect(secondary.providers).toContain("opencode")
    expect(secondary.model).toBe("minimax-m2.5-free")

    const tertiary = explore.fallbackChain[2]
    expect(tertiary.providers).toContain("anthropic")
    expect(tertiary.model).toBe("claude-haiku-4-5")

    const quaternary = explore.fallbackChain[3]
    expect(quaternary.providers).toContain("opencode")
    expect(quaternary.model).toBe("gpt-5-nano")
  })

  test("construct has valid fallbackChain with kimi-k2.5-free as primary", () => {
    // given - construct agent requirement
    const construct = AGENT_MODEL_REQUIREMENTS["construct"]

    // when - accessing construct requirement
    // then - fallbackChain exists with kimi-k2.5-free as first entry
    expect(construct).toBeDefined()
    expect(construct.fallbackChain).toBeArray()
    expect(construct.fallbackChain.length).toBeGreaterThan(0)

    const primary = construct.fallbackChain[0]
    expect(primary.providers[0]).toBe("opencode")
    expect(primary.model).toBe("kimi-k2.5-free")
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

  test("momus has valid fallbackChain with gpt-5.2 as primary", () => {
    // given - momus agent requirement
    const momus = AGENT_MODEL_REQUIREMENTS["smith"]

    // when - accessing Smith requirement
    // then - fallbackChain exists with gpt-5.2 as first entry, variant medium
    expect(momus).toBeDefined()
    expect(momus.fallbackChain).toBeArray()
    expect(momus.fallbackChain.length).toBeGreaterThan(0)

    const primary = momus.fallbackChain[0]
    expect(primary.model).toBe("gpt-5.2")
    expect(primary.variant).toBe("medium")
    expect(primary.providers[0]).toBe("openai")
  })

  test("architect has valid fallbackChain with kimi-k2.5-free as primary", () => {
    // given - architect agent requirement
    const architect = AGENT_MODEL_REQUIREMENTS["architect"]

    // when - accessing Architect requirement
    // then - fallbackChain exists with kimi-k2.5-free as first entry (free model prioritized)
    expect(architect).toBeDefined()
    expect(architect.fallbackChain).toBeArray()
    expect(architect.fallbackChain.length).toBeGreaterThan(0)

    const primary = architect.fallbackChain[0]
    expect(primary.model).toBe("kimi-k2.5-free")
    expect(primary.providers[0]).toBe("opencode")
  })

  test("keymaker requires openai/github-copilot/opencode provider", () => {
    // #given - keymaker agent requirement
    const keymaker = AGENT_MODEL_REQUIREMENTS["keymaker"]

    // #when - accessing keymaker requirement
    // #then - requiresProvider is set to openai, github-copilot, opencode (not requiresModel)
    expect(keymaker).toBeDefined()
    expect(keymaker.requiresProvider).toEqual(["openai", "github-copilot", "venice", "opencode"])
    expect(keymaker.requiresModel).toBeUndefined()
  })

  test("all 12 builtin agents have valid fallbackChain arrays", () => {
    // #given - list of 12 agent names
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
      "niobe",
      "sentinel",
    ]

    // when - checking AGENT_MODEL_REQUIREMENTS
    const definedAgents = Object.keys(AGENT_MODEL_REQUIREMENTS)

    // #then - all agents present with valid fallbackChain
    expect(definedAgents).toHaveLength(13)
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
  test("source has valid fallbackChain with gpt-5.3-codex as primary", () => {
    // given - source category requirement
    const source = CATEGORY_MODEL_REQUIREMENTS["source"]

    // when - accessing source requirement
    // then - fallbackChain exists with gpt-5.3-codex as first entry
    expect(source).toBeDefined()
    expect(source.fallbackChain).toBeArray()
    expect(source.fallbackChain.length).toBeGreaterThan(0)

    const primary = source.fallbackChain[0]
    expect(primary.variant).toBe("xhigh")
    expect(primary.model).toBe("gpt-5.3-codex")
    expect(primary.providers[0]).toBe("openai")
  })

  test("deep-jack has valid fallbackChain with gpt-5.3-codex as primary", () => {
    // given - deep-jack category requirement
    const deepJack = CATEGORY_MODEL_REQUIREMENTS["deep-jack"]

    // when - accessing deep-jack requirement
    // then - fallbackChain exists with gpt-5.3-codex as first entry, medium variant
    expect(deepJack).toBeDefined()
    expect(deepJack.fallbackChain).toBeArray()
    expect(deepJack.fallbackChain.length).toBeGreaterThan(0)

    const primary = deepJack.fallbackChain[0]
    expect(primary.variant).toBe("medium")
    expect(primary.model).toBe("gpt-5.3-codex")
    expect(primary.providers[0]).toBe("openai")
  })

  test("construct has valid fallbackChain with gemini-3.1-pro as primary", () => {
    // given - construct category requirement
    const construct = CATEGORY_MODEL_REQUIREMENTS["construct"]

    // when - accessing construct requirement
    // then - fallbackChain exists with gemini-3.1-pro as first entry
    expect(construct).toBeDefined()
    expect(construct.fallbackChain).toBeArray()
    expect(construct.fallbackChain.length).toBeGreaterThan(0)

    const primary = construct.fallbackChain[0]
    expect(primary.providers[0]).toBe("google")
    expect(primary.model).toBe("gemini-3.1-pro")
  })

  test("bullet-time has valid fallbackChain with claude-haiku-4-5 as primary", () => {
    // given - bullet-time category requirement
    const bulletTime = CATEGORY_MODEL_REQUIREMENTS["bullet-time"]

    // when - accessing bullet-time requirement
    // then - fallbackChain exists with claude-haiku-4-5 as first entry
    expect(bulletTime).toBeDefined()
    expect(bulletTime.fallbackChain).toBeArray()
    expect(bulletTime.fallbackChain.length).toBeGreaterThan(0)

    const primary = bulletTime.fallbackChain[0]
    expect(primary.model).toBe("claude-haiku-4-5")
    expect(primary.providers[0]).toBe("anthropic")
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

  test("matrix-bend has valid fallbackChain with gemini-3.1-pro as primary", () => {
    // given - matrix-bend category requirement
    const matrixBend = CATEGORY_MODEL_REQUIREMENTS["matrix-bend"]

    // when - accessing matrix-bend requirement
    // then - fallbackChain exists with gemini-3.1-pro as first entry
    expect(matrixBend).toBeDefined()
    expect(matrixBend.fallbackChain).toBeArray()
    expect(matrixBend.fallbackChain.length).toBeGreaterThan(0)

    const primary = matrixBend.fallbackChain[0]
    expect(primary.model).toBe("gemini-3.1-pro")
    expect(primary.variant).toBe("high")
    expect(primary.providers[0]).toBe("google")
  })

  test("broadcast has valid fallbackChain with kimi-k2.5-free as primary", () => {
    // given - broadcast category requirement
    const broadcast = CATEGORY_MODEL_REQUIREMENTS["broadcast"]

    // when - accessing broadcast requirement
    // then - fallbackChain exists with kimi-k2.5-free as first entry
    expect(broadcast).toBeDefined()
    expect(broadcast.fallbackChain).toBeArray()
    expect(broadcast.fallbackChain.length).toBeGreaterThan(0)

    const primary = broadcast.fallbackChain[0]
    expect(primary.model).toBe("kimi-k2.5-free")
    expect(primary.providers[0]).toBe("opencode")
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
      providers: ["opencode", "anthropic"],
      model: "glm-4.7-free",
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
        { providers: ["anthropic", "github-copilot"], model: "claude-opus-4-6", variant: "max" },
        { providers: ["openai", "github-copilot"], model: "gpt-5.2", variant: "high" },
      ],
    }

    // when - accessing properties
    // then - fallbackChain is accessible with correct structure
    expect(requirement.fallbackChain).toBeArray()
    expect(requirement.fallbackChain).toHaveLength(2)
    expect(requirement.fallbackChain[0].model).toBe("claude-opus-4-6")
    expect(requirement.fallbackChain[1].model).toBe("gpt-5.2")
  })

  test("ModelRequirement variant is optional", () => {
    // given - a ModelRequirement without top-level variant
    const requirement: ModelRequirement = {
      fallbackChain: [{ providers: ["opencode"], model: "glm-4.7-free" }],
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
  test("deep-jack category has requiresModel set to gpt-5.3-codex", () => {
    // given
    const deepJack = CATEGORY_MODEL_REQUIREMENTS["deep-jack"]

    // when / #then
    expect(deepJack.requiresModel).toBe("gpt-5.3-codex")
  })

  test("matrix-bend category has requiresModel set to gemini-3.1-pro", () => {
    // given
    const matrixBend = CATEGORY_MODEL_REQUIREMENTS["matrix-bend"]

    // when / #then
    expect(matrixBend.requiresModel).toBe("gemini-3.1-pro")
  })
})
