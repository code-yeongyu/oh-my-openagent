import { describe, it, expect } from "bun:test"
import { PROFILE_PRESETS, DEFAULT_PROFILE, getProfileOverride } from "./profiles"

describe("Model Profiles", () => {
  describe("#given profile presets", () => {
    describe("#when accessing premium profile", () => {
      it("#then returns empty overrides", () => {
        expect(PROFILE_PRESETS.premium).toEqual({})
      })
    })

    describe("#when accessing balanced profile", () => {
      it("#then returns empty overrides", () => {
        expect(PROFILE_PRESETS.balanced).toEqual({})
      })
    })

    describe("#when accessing economy profile", () => {
      it("#then has overrides for expensive agents", () => {
        const economy = PROFILE_PRESETS.economy
        expect(economy.sisyphus).toBeDefined()
        expect(economy.oracle).toBeDefined()
        expect(economy.metis).toBeDefined()
        expect(economy.momus).toBeDefined()
        expect(economy.prometheus).toBeDefined()
        expect("multimodal-looker" in economy).toBe(true)
      })

      it("#then has no overrides for cheap agents", () => {
        const economy = PROFILE_PRESETS.economy
        expect(economy.hephaestus).toBeUndefined()
        expect(economy.explore).toBeUndefined()
        expect(economy.librarian).toBeUndefined()
        expect(economy.atlas).toBeUndefined()
        expect(economy["sisyphus-junior"]).toBeUndefined()
      })

      it("#then sisyphus downgrades to claude-sonnet-4-6", () => {
        const override = PROFILE_PRESETS.economy.sisyphus
        expect(override?.model).toBe("claude-sonnet-4-6")
        expect(override?.variant).toBeUndefined()
      })

      it("#then oracle downgrades to gemini-3-flash", () => {
        const override = PROFILE_PRESETS.economy.oracle
        expect(override?.model).toBe("gemini-3-flash")
        expect(override?.variant).toBeUndefined()
      })

      it("#then metis downgrades to gpt-5.4 medium", () => {
        const override = PROFILE_PRESETS.economy.metis
        expect(override?.model).toBe("gpt-5.4")
        expect(override?.variant).toBe("medium")
      })

      it("#then momus downgrades to gemini-3.1-pro medium", () => {
        const override = PROFILE_PRESETS.economy.momus
        expect(override?.model).toBe("gemini-3.1-pro")
        expect(override?.variant).toBe("medium")
      })

      it("#then prometheus downgrades to gpt-5.4 medium", () => {
        const override = PROFILE_PRESETS.economy.prometheus
        expect(override?.model).toBe("gpt-5.4")
        expect(override?.variant).toBe("medium")
      })

      it("#then multimodal-looker downgrades to gemini-3-flash", () => {
        const override = PROFILE_PRESETS.economy["multimodal-looker"]
        expect(override?.model).toBe("gemini-3-flash")
        expect(override?.variant).toBeUndefined()
      })
    })
  })

  describe("#given default profile", () => {
    it("#then is balanced", () => {
      expect(DEFAULT_PROFILE).toBe("balanced")
    })
  })

  describe("#given getProfileOverride function", () => {
    describe("#when looking up premium profile", () => {
      it("#then returns undefined for any agent", () => {
        expect(getProfileOverride("premium", "sisyphus")).toBeUndefined()
        expect(getProfileOverride("premium", "oracle")).toBeUndefined()
      })
    })

    describe("#when looking up balanced profile", () => {
      it("#then returns undefined for any agent", () => {
        expect(getProfileOverride("balanced", "sisyphus")).toBeUndefined()
        expect(getProfileOverride("balanced", "oracle")).toBeUndefined()
      })
    })

    describe("#when looking up economy profile", () => {
      it("#then returns override for sisyphus", () => {
        const override = getProfileOverride("economy", "sisyphus")
        expect(override).toEqual({ model: "claude-sonnet-4-6" })
      })

      it("#then returns undefined for hephaestus", () => {
        expect(getProfileOverride("economy", "hephaestus")).toBeUndefined()
      })

      it("#then returns undefined for unknown agent", () => {
        expect(getProfileOverride("economy", "unknown-agent")).toBeUndefined()
      })
    })
  })
})
