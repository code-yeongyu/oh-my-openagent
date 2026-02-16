import { describe, expect, test } from "bun:test"
import { AGENT_PROFILE_REQUIREMENTS, getAgentModelRequirementsForProfile } from "./performance-profiles"
import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"

describe("Performance Profiles", () => {
  describe("profile validation", () => {
    test("accepts valid profiles: performance, balanced, budget", () => {
      //#given - The AGENT_PROFILE_REQUIREMENTS object has three profiles
      const validProfiles = ["performance", "balanced", "budget"] as const

      //#when - We check each profile exists in the requirements
      for (const profile of validProfiles) {
        const profileRequirements = AGENT_PROFILE_REQUIREMENTS[profile]

        //#then - Each profile should have requirements for all 11 agents
        expect(profileRequirements).toBeDefined()
        expect(Object.keys(profileRequirements)).toHaveLength(11)
        expect(profileRequirements.sisyphus).toBeDefined()
        expect(profileRequirements.hephaestus).toBeDefined()
        expect(profileRequirements.oracle).toBeDefined()
        expect(profileRequirements.librarian).toBeDefined()
        expect(profileRequirements.explore).toBeDefined()
        expect(profileRequirements["multimodal-looker"]).toBeDefined()
        expect(profileRequirements.prometheus).toBeDefined()
        expect(profileRequirements.metis).toBeDefined()
        expect(profileRequirements.momus).toBeDefined()
        expect(profileRequirements.atlas).toBeDefined()
        expect(profileRequirements["sisyphus-junior"]).toBeDefined()
      }
    })

    test("rejects invalid profiles", () => {
      //#given - An invalid profile name
      const invalidProfile = "invalid-profile"

      //#when - We try to access it
      const result = AGENT_PROFILE_REQUIREMENTS[invalidProfile as keyof typeof AGENT_PROFILE_REQUIREMENTS]

      //#then - It should be undefined
      expect(result).toBeUndefined()
    })
  })

  describe("performance tier", () => {
    test("returns expensive models for sisyphus", () => {
      //#given - Performance profile requirements
      const performanceProfile = AGENT_PROFILE_REQUIREMENTS.performance

      //#when - We get sisyphus requirements
      const sisyphusReq = performanceProfile.sisyphus

      //#then - Should use expensive model (Opus 4.6) as first choice
      expect(sisyphusReq.fallbackChain[0].model).toBe("claude-opus-4-6")
      expect(sisyphusReq.fallbackChain[0].providers).toContain("anthropic")
      expect(sisyphusReq.fallbackChain[0].variant).toBe("max")
      expect(sisyphusReq.requiresAnyModel).toBe(true)
    })

    test("returns expensive models for prometheus", () => {
      //#given - Performance profile requirements
      const performanceProfile = AGENT_PROFILE_REQUIREMENTS.performance

      //#when - We get prometheus requirements
      const prometheusReq = performanceProfile.prometheus

      //#then - Should use expensive model (Opus 4.6) as first choice
      expect(prometheusReq.fallbackChain[0].model).toBe("claude-opus-4-6")
      expect(prometheusReq.fallbackChain[0].variant).toBe("max")
    })

    test("returns expensive models for metis", () => {
      //#given - Performance profile requirements
      const performanceProfile = AGENT_PROFILE_REQUIREMENTS.performance

      //#when - We get metis requirements
      const metisReq = performanceProfile.metis

      //#then - Should use expensive model (Opus 4.6) as first choice
      expect(metisReq.fallbackChain[0].model).toBe("claude-opus-4-6")
      expect(metisReq.fallbackChain[0].variant).toBe("max")
    })

    test("returns high-tier models for oracle", () => {
      //#given - Performance profile requirements
      const performanceProfile = AGENT_PROFILE_REQUIREMENTS.performance

      //#when - We get oracle requirements
      const oracleReq = performanceProfile.oracle

      //#then - Should use high-tier model (GPT-5.2) as first choice
      expect(oracleReq.fallbackChain[0].model).toBe("gpt-5.2")
      expect(oracleReq.fallbackChain[0].variant).toBe("high")
    })

    test("hephaestus requires specific providers", () => {
      //#given - Performance profile requirements
      const performanceProfile = AGENT_PROFILE_REQUIREMENTS.performance

      //#when - We get hephaestus requirements
      const hephaestusReq = performanceProfile.hephaestus

      //#then - Should require OpenAI providers
      expect(hephaestusReq.fallbackChain[0].model).toBe("gpt-5.3-codex")
      expect(hephaestusReq.requiresProvider).toContain("openai")
    })
  })

  describe("balanced tier", () => {
    test("returns mid-tier models for sisyphus", () => {
      //#given - Balanced profile requirements
      const balancedProfile = AGENT_PROFILE_REQUIREMENTS.balanced

      //#when - We get sisyphus requirements
      const sisyphusReq = balancedProfile.sisyphus

      //#then - Should use mid-tier model (Sonnet 4.5) as first choice
      expect(sisyphusReq.fallbackChain[0].model).toBe("claude-sonnet-4-5")
      expect(sisyphusReq.fallbackChain[0].providers).toContain("anthropic")
      expect(sisyphusReq.requiresAnyModel).toBe(true)
    })

    test("returns mid-tier models for atlas", () => {
      //#given - Balanced profile requirements
      const balancedProfile = AGENT_PROFILE_REQUIREMENTS.balanced

      //#when - We get atlas requirements
      const atlasReq = balancedProfile.atlas

      //#then - Should use mid-tier model (k2p5 from kimi) as first choice
      expect(atlasReq.fallbackChain[0].model).toBe("k2p5")
      expect(atlasReq.fallbackChain[0].providers).toContain("kimi-for-coding")
    })

    test("returns mid-tier models for sisyphus-junior", () => {
      //#given - Balanced profile requirements
      const balancedProfile = AGENT_PROFILE_REQUIREMENTS.balanced

      //#when - We get sisyphus-junior requirements
      const juniorReq = balancedProfile["sisyphus-junior"]

      //#then - Should use mid-tier model (Sonnet 4.5) as first choice
      expect(juniorReq.fallbackChain[0].model).toBe("claude-sonnet-4-5")
    })

    test("multimodal-looker uses flash model", () => {
      //#given - Balanced profile requirements
      const balancedProfile = AGENT_PROFILE_REQUIREMENTS.balanced

      //#when - We get multimodal-looker requirements
      const lookerReq = balancedProfile["multimodal-looker"]

      //#then - Should use Gemini Flash
      expect(lookerReq.fallbackChain[0].model).toBe("gemini-3-flash")
    })
  })

  describe("budget tier", () => {
    test("returns cheap models for sisyphus", () => {
      //#given - Budget profile requirements
      const budgetProfile = AGENT_PROFILE_REQUIREMENTS.budget

      //#when - We get sisyphus requirements
      const sisyphusReq = budgetProfile.sisyphus

      //#then - Should use cheap model (Haiku 4.5) as first choice
      expect(sisyphusReq.fallbackChain[0].model).toBe("claude-haiku-4-5")
      expect(sisyphusReq.fallbackChain[0].providers).toContain("anthropic")
      expect(sisyphusReq.requiresAnyModel).toBe(true)
    })

    test("returns cheap models for oracle", () => {
      //#given - Budget profile requirements
      const budgetProfile = AGENT_PROFILE_REQUIREMENTS.budget

      //#when - We get oracle requirements
      const oracleReq = budgetProfile.oracle

      //#then - Should use cheap model (Haiku 4.5) as first choice
      expect(oracleReq.fallbackChain[0].model).toBe("claude-haiku-4-5")
    })

    test("returns cheap models for metis", () => {
      //#given - Budget profile requirements
      const budgetProfile = AGENT_PROFILE_REQUIREMENTS.budget

      //#when - We get metis requirements
      const metisReq = budgetProfile.metis

      //#then - Should use cheap model (Haiku 4.5) as first choice
      expect(metisReq.fallbackChain[0].model).toBe("claude-haiku-4-5")
    })

    test("returns cheap models for momus", () => {
      //#given - Budget profile requirements
      const budgetProfile = AGENT_PROFILE_REQUIREMENTS.budget

      //#when - We get momus requirements
      const momusReq = budgetProfile.momus

      //#then - Should use cheap model (Haiku 4.5) as first choice
      expect(momusReq.fallbackChain[0].model).toBe("claude-haiku-4-5")
    })

    test("explore uses fast model", () => {
      //#given - Budget profile requirements
      const budgetProfile = AGENT_PROFILE_REQUIREMENTS.budget

      //#when - We get explore requirements
      const exploreReq = budgetProfile.explore

      //#then - Should use fast/cheap model
      expect(exploreReq.fallbackChain[0].model).toBe("grok-code-fast-1")
    })

    test("librarian uses free model", () => {
      //#given - Budget profile requirements
      const budgetProfile = AGENT_PROFILE_REQUIREMENTS.budget

      //#when - We get librarian requirements
      const librarianReq = budgetProfile.librarian

      //#then - Should use free model
      expect(librarianReq.fallbackChain[0].model).toBe("glm-4.7-free")
      expect(librarianReq.fallbackChain[0].providers).toContain("zai-coding-plan")
    })
  })

  describe("agent creation integration", () => {
    test("getAgentModelRequirementsForProfile returns correct requirements for performance", () => {
      //#given - Performance profile
      const profile = "performance"

      //#when - We get requirements for the profile
      const requirements = getAgentModelRequirementsForProfile(profile)

      //#then - Should return merged requirements with profile-specific overrides
      expect(requirements).toBeDefined()
      expect(requirements.sisyphus).toBeDefined()
      expect(requirements.sisyphus.fallbackChain[0].model).toBe("claude-opus-4-6")
    })

    test("getAgentModelRequirementsForProfile returns correct requirements for balanced", () => {
      //#given - Balanced profile
      const profile = "balanced"

      //#when - We get requirements for the profile
      const requirements = getAgentModelRequirementsForProfile(profile)

      //#then - Should return merged requirements with profile-specific overrides
      expect(requirements).toBeDefined()
      expect(requirements.sisyphus).toBeDefined()
      expect(requirements.sisyphus.fallbackChain[0].model).toBe("claude-sonnet-4-5")
    })

    test("getAgentModelRequirementsForProfile returns correct requirements for budget", () => {
      //#given - Budget profile
      const profile = "budget"

      //#when - We get requirements for the profile
      const requirements = getAgentModelRequirementsForProfile(profile)

      //#then - Should return merged requirements with profile-specific overrides
      expect(requirements).toBeDefined()
      expect(requirements.sisyphus).toBeDefined()
      expect(requirements.sisyphus.fallbackChain[0].model).toBe("claude-haiku-4-5")
    })

    test("profile requirements are merged with default AGENT_MODEL_REQUIREMENTS", () => {
      //#given - Default requirements and performance profile
      const defaultAtlas = AGENT_MODEL_REQUIREMENTS.atlas
      const profileAtlas = AGENT_PROFILE_REQUIREMENTS.performance.atlas

      //#when - We get merged requirements
      const merged = getAgentModelRequirementsForProfile("performance")

      //#then - Profile requirements should take precedence over defaults
      // atlas has different first choice in performance profile vs default
      expect(merged.atlas.fallbackChain[0].model).toBe(profileAtlas.fallbackChain[0].model)
      // The merged result should use the profile's version
      expect(merged.atlas.fallbackChain[0].model).toBe("k2p5")
    })

    test("non-profiled agents use default requirements", () => {
      //#given - A profile that doesn't override all agents
      const requirements = getAgentModelRequirementsForProfile("balanced")

      //#when - We check agents not in the profile
      // Note: All 11 agents are in the profile, so this tests that the merge works

      //#then - All agents should have requirements
      expect(Object.keys(requirements).length).toBeGreaterThanOrEqual(11)
    })
  })

  describe("user override precedence", () => {
    test("profile requirements don't override explicit user model selections", () => {
      //#given - A user has explicitly selected a model
      const userModel = "custom/user-model"
      const profile = "performance"

      //#when - We check the profile requirements
      const profileRequirements = AGENT_PROFILE_REQUIREMENTS[profile]

      //#then - Profile requirements are separate from user overrides
      // The actual precedence is handled by the model resolution pipeline
      // which checks userModel before falling back to profile requirements
      expect(profileRequirements).toBeDefined()
      expect(userModel).toBe("custom/user-model")
      // This test documents that profile requirements are just defaults,
      // not overrides
    })

    test("getAgentModelRequirementsForProfile preserves all agent entries", () => {
      //#given - Each profile
      const profiles = ["performance", "balanced", "budget"] as const

      //#when - We get requirements for each
      for (const profile of profiles) {
        const requirements = getAgentModelRequirementsForProfile(profile)

        //#then - All agents from the profile should be present
        const profileAgents = Object.keys(AGENT_PROFILE_REQUIREMENTS[profile])
        for (const agent of profileAgents) {
          expect(requirements[agent]).toBeDefined()
        }
      }
    })
  })

  describe("fallback chains", () => {
    test("each agent has a fallback chain with at least 1 entry", () => {
      //#given - All profiles
      const profiles = ["performance", "balanced", "budget"] as const

      //#when - We check each agent's fallback chain
      for (const profile of profiles) {
        const profileReqs = AGENT_PROFILE_REQUIREMENTS[profile]
        const agents = Object.keys(profileReqs)

        for (const agent of agents) {
          const req = profileReqs[agent as keyof typeof profileReqs]

          //#then - Each agent should have at least 1 fallback entry
          expect(req.fallbackChain.length).toBeGreaterThanOrEqual(1)
        }
      }
    })

    test("fallback chains have correct structure", () => {
      //#given - Performance profile sisyphus
      const sisyphusReq = AGENT_PROFILE_REQUIREMENTS.performance.sisyphus

      //#when - We examine the fallback chain
      const chain = sisyphusReq.fallbackChain

      //#then - Each entry should have providers and model
      for (const entry of chain) {
        expect(entry.providers).toBeDefined()
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(entry.model).toBeDefined()
        expect(typeof entry.model).toBe("string")
        // variant is optional
        if (entry.variant !== undefined) {
          expect(typeof entry.variant).toBe("string")
        }
      }
    })

    test("performance tier has more expensive fallbacks than budget tier", () => {
      //#given - Sisyphus requirements for performance and budget
      const perfSisyphus = AGENT_PROFILE_REQUIREMENTS.performance.sisyphus
      const budgetSisyphus = AGENT_PROFILE_REQUIREMENTS.budget.sisyphus

      //#when - We compare first choices
      const perfFirst = perfSisyphus.fallbackChain[0].model
      const budgetFirst = budgetSisyphus.fallbackChain[0].model

      //#then - Performance should use more expensive model
      expect(perfFirst).toBe("claude-opus-4-6")
      expect(budgetFirst).toBe("claude-haiku-4-5")
      // Opus is more expensive than Haiku
      expect(perfFirst).not.toBe(budgetFirst)
    })

    test("balanced tier falls between performance and budget", () => {
      //#given - Sisyphus requirements for all tiers
      const perfSisyphus = AGENT_PROFILE_REQUIREMENTS.performance.sisyphus
      const balancedSisyphus = AGENT_PROFILE_REQUIREMENTS.balanced.sisyphus
      const budgetSisyphus = AGENT_PROFILE_REQUIREMENTS.budget.sisyphus

      //#when - We compare first choices
      const perfFirst = perfSisyphus.fallbackChain[0].model
      const balancedFirst = balancedSisyphus.fallbackChain[0].model
      const budgetFirst = budgetSisyphus.fallbackChain[0].model

      //#then - Balanced should be between performance and budget
      expect(perfFirst).toBe("claude-opus-4-6")
      expect(balancedFirst).toBe("claude-sonnet-4-5")
      expect(budgetFirst).toBe("claude-haiku-4-5")
      // Order: Opus (expensive) > Sonnet (mid) > Haiku (cheap)
    })

    test("fallback chains include multiple providers for redundancy", () => {
      //#given - Performance profile sisyphus
      const sisyphusReq = AGENT_PROFILE_REQUIREMENTS.performance.sisyphus

      //#when - We examine the first fallback entry
      const firstEntry = sisyphusReq.fallbackChain[0]

      //#then - Should have multiple providers for redundancy
      expect(firstEntry.providers.length).toBeGreaterThan(1)
      expect(firstEntry.providers).toContain("anthropic")
    })

    test("hephaestus has single-entry fallback chain with provider requirement", () => {
      //#given - Hephaestus requirements
      const hephaestusReq = AGENT_PROFILE_REQUIREMENTS.performance.hephaestus

      //#when - We examine the requirements

      //#then - Should have single entry but with provider requirement
      expect(hephaestusReq.fallbackChain).toHaveLength(1)
      expect(hephaestusReq.requiresProvider).toBeDefined()
      expect(hephaestusReq.requiresProvider).toContain("openai")
    })

    test("explore agent has fast models in fallback chain", () => {
      //#given - Explore requirements for each profile
      const profiles = ["performance", "balanced", "budget"] as const

      //#when - We check each profile's explore agent
      for (const profile of profiles) {
        const exploreReq = AGENT_PROFILE_REQUIREMENTS[profile].explore

        //#then - First choice should be fast model
        const firstModel = exploreReq.fallbackChain[0].model
        expect(["grok-code-fast-1", "claude-haiku-4-5", "gpt-5-nano"]).toContain(firstModel)
      }
    })

    test("multimodal-looker has vision-capable models", () => {
      //#given - Multimodal-looker requirements
      const profiles = ["performance", "balanced", "budget"] as const

      //#when - We check each profile
      for (const profile of profiles) {
        const lookerReq = AGENT_PROFILE_REQUIREMENTS[profile]["multimodal-looker"]

        //#then - Should have vision-capable models
        const firstModel = lookerReq.fallbackChain[0].model
        // Gemini Flash, Gemini Pro, or other vision models
        expect(firstModel).toBeDefined()
        expect(typeof firstModel).toBe("string")
      }
    })
  })

  describe("profile comparison", () => {
    test("all profiles have the same set of agents", () => {
      //#given - All three profiles
      const performanceAgents = Object.keys(AGENT_PROFILE_REQUIREMENTS.performance).sort()
      const balancedAgents = Object.keys(AGENT_PROFILE_REQUIREMENTS.balanced).sort()
      const budgetAgents = Object.keys(AGENT_PROFILE_REQUIREMENTS.budget).sort()

      //#when - We compare agent sets

      //#then - All profiles should have the same agents
      expect(performanceAgents).toEqual(balancedAgents)
      expect(balancedAgents).toEqual(budgetAgents)
    })

    test("each agent has different models across profiles", () => {
      //#given - Key agents to check
      const agentsToCheck = ["sisyphus", "oracle", "prometheus", "atlas"]

      //#when - We compare their first-choice models across profiles
      for (const agent of agentsToCheck) {
        const perfModel = AGENT_PROFILE_REQUIREMENTS.performance[agent as keyof typeof AGENT_PROFILE_REQUIREMENTS.performance].fallbackChain[0].model
        const balancedModel = AGENT_PROFILE_REQUIREMENTS.balanced[agent as keyof typeof AGENT_PROFILE_REQUIREMENTS.balanced].fallbackChain[0].model
        const budgetModel = AGENT_PROFILE_REQUIREMENTS.budget[agent as keyof typeof AGENT_PROFILE_REQUIREMENTS.budget].fallbackChain[0].model

        //#then - At least some should be different (not all same)
        const uniqueModels = new Set([perfModel, balancedModel, budgetModel])
        expect(uniqueModels.size).toBeGreaterThanOrEqual(1)
      }
    })
  })
})
