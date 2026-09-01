import { describe, expect, test } from "bun:test"

import { OmoTaskSettingsSchema, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { resolveReflectionModel, shouldWarnCategoryUnavailable } from "./resolve-model"

const model: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
const registry = {
  getAvailable: () => [model],
  find: (provider: string, modelId: string) =>
    provider === model.provider && modelId === model.id ? model : undefined,
}

describe("resolveReflectionModel", () => {
  test("#given quick category model and reasoning #when resolved #then it returns the Senpi model selector and thinking level", () => {
    // given
    const config: OmoConfig = {
      categories: { quick: { model: "omo-mock/mock-1", reasoning: "high" } },
    }

    // when
    const result = resolveReflectionModel("quick", config, registry)

    // then
    expect(result).toEqual({
      kind: "resolved",
      category: "quick",
      model: "omo-mock/mock-1",
      thinking: "high",
      fallbacks: [],
    })
  })

  test("#given an empty model registry #when quick cannot resolve #then it fails closed as category_unavailable", () => {
    // given
    const config: OmoConfig = { categories: {} }

    // when
    const result = resolveReflectionModel("quick", config, {
      getAvailable: () => [],
      find: () => undefined,
    })

    // then
    expect(result.kind).toBe("category_unavailable")
    if (result.kind === "category_unavailable") {
      expect(result.category).toBe("quick")
      expect(result.attemptedChain?.length).toBeGreaterThan(0)
    }
  })

  test("#given a pinned user model with a stale availability snapshot #when resolved #then find() wins over the gate", () => {
    // given: availability is stale (empty) but registry.find can still locate the pinned model
    const staleRegistry = {
      getAvailable: () => [],
      find: (provider: string, modelId: string) =>
        provider === model.provider && modelId === model.id ? model : undefined,
    }
    const config: OmoConfig = {
      categories: { quick: { model: "omo-mock/mock-1" } },
    }

    // when
    const result = resolveReflectionModel("quick", config, staleRegistry)

    // then
    expect(result).toEqual({ kind: "resolved", category: "quick", model: "omo-mock/mock-1", fallbacks: [] })
  })

  test("#given a pinned model that find() cannot locate #when resolved #then it still fails closed", () => {
    // given
    const staleRegistry = {
      getAvailable: () => [],
      find: () => undefined,
    }
    const config: OmoConfig = {
      categories: { quick: { model: "omo-mock/ghost" } },
    }

    // when
    const result = resolveReflectionModel("quick", config, staleRegistry)

    // then
    expect(result.kind).toBe("category_unavailable")
  })

  test("#given canonical models and a stale availability snapshot #when find locates the chain #then reflection preserves every fallback", () => {
    // given
    const primary: SenpiModelPort = { provider: "extension-only", id: "primary" }
    const fallback: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
    const staleRegistry = {
      getAvailable: () => [],
      find: (provider: string, modelId: string) =>
        [primary, fallback].find((candidate) =>
          candidate.provider === provider && candidate.id === modelId
        ),
    }
    const config: OmoConfig = {
      categories: {
        quick: {
          models: [
            { model: "extension-only/primary", reasoning: "off" },
            { model: "omo-mock/mock-1", reasoning: "minimal" },
          ],
        },
      },
    }

    // when
    const result = resolveReflectionModel("quick", config, staleRegistry)

    // then
    expect(result).toEqual({
      kind: "resolved",
      category: "quick",
      model: "extension-only/primary",
      thinking: "off",
      fallbacks: [{ model: "omo-mock/mock-1", thinking: "minimal" }],
    })
  })

  test("#given the LAST canonical rung is selected #when earlier rungs are still findable #then they remain reflection fallbacks", () => {
    // given: the availability snapshot only lists the last rung, so the category selects it, while
    // find() (the direct lookup that beats a stale snapshot) still locates the earlier rung.
    const earlier: SenpiModelPort = { provider: "extension-only", id: "primary" }
    const selected: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
    const snapshotRegistry = {
      getAvailable: () => [selected],
      find: (provider: string, modelId: string) =>
        [earlier, selected].find((candidate) =>
          candidate.provider === provider && candidate.id === modelId
        ),
    }
    const config: OmoConfig = {
      categories: {
        quick: {
          models: [
            { model: "extension-only/primary", reasoning: "off" },
            { model: "omo-mock/mock-1", reasoning: "minimal" },
          ],
        },
      },
    }

    // when
    const result = resolveReflectionModel("quick", config, snapshotRegistry)

    // then
    expect(result).toEqual({
      kind: "resolved",
      category: "quick",
      model: "omo-mock/mock-1",
      thinking: "minimal",
      fallbacks: [{ model: "extension-only/primary", thinking: "off" }],
    })
  })

  test("#given legacy fallback_models and a stale availability snapshot #when find locates the chain #then reflection preserves every fallback", () => {
    // given
    const primary: SenpiModelPort = { provider: "extension-only", id: "primary" }
    const fallback: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
    const staleRegistry = {
      getAvailable: () => [],
      find: (provider: string, modelId: string) =>
        [primary, fallback].find((candidate) =>
          candidate.provider === provider && candidate.id === modelId
        ),
    }
    const config: OmoConfig = {
      categories: {
        quick: {
          model: "extension-only/primary",
          reasoning: "off",
          fallback_models: [{ model: "omo-mock/mock-1", reasoning: "minimal" }],
        },
      },
    }

    // when
    const result = resolveReflectionModel("quick", config, staleRegistry)

    // then
    expect(result).toEqual({
      kind: "resolved",
      category: "quick",
      model: "extension-only/primary",
      thinking: "off",
      fallbacks: [{ model: "omo-mock/mock-1", thinking: "minimal" }],
    })
  })

  describe("#given no category rung covers the connected providers", () => {
    // Discord report 1537678248337739826: providers whose model ids appear in no quick-chain
    // rung (google here) dead-chain today, so resolution must fall back to what the runtime
    // registry actually exposes.
    const flash = {
      provider: "google",
      id: "gemini-3.6-flash",
      cost: { input: 0.3, output: 2.5, cacheRead: 0.03 },
      contextWindow: 1_000_000,
    }
    const pro = {
      provider: "google",
      id: "gemini-3.1-pro",
      cost: { input: 2, output: 12, cacheRead: 0.2 },
      contextWindow: 1_000_000,
    }
    const embedding = {
      provider: "google",
      id: "text-embedding-005",
      cost: { input: 0.01, output: 0, cacheRead: 0 },
      contextWindow: 8192,
    }
    const liveRegistry = {
      getAvailable: () => [pro, embedding, flash],
      find: (provider: string, modelId: string) =>
        [pro, embedding, flash].find((candidate) => candidate.provider === provider && candidate.id === modelId),
    }

    test("#when the live registry exposes priced chat models #then the cheapest one resolves as registry fallback", () => {
      // when
      const result = resolveReflectionModel("quick", { categories: {} }, liveRegistry)

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind === "resolved") {
        expect(result.model).toBe("google/gemini-3.6-flash")
        expect(result.source).toBe("registry_fallback")
        expect(result.fallbacks).toEqual([{ model: "google/gemini-3.1-pro" }])
      }
    })

    test("#when a pricier session model is also present #then the registry candidate still wins the ladder", () => {
      // when: session runs the expensive pro model, registry still exposes the cheap flash
      const result = resolveReflectionModel("quick", { categories: {} }, liveRegistry, {
        sessionModel: { provider: "google", id: "gemini-3.1-pro" },
      })

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind === "resolved") {
        expect(result.model).toBe("google/gemini-3.6-flash")
        expect(result.source).toBe("registry_fallback")
      }
    })

    test("#when the session model is cheaper than every registry candidate #then the cost chooser inherits it", () => {
      // given: only a pricey registry candidate is connected, session runs a cheaper model
      const pricey = {
        provider: "google",
        id: "gemini-3.1-pro",
        cost: { input: 2, output: 12, cacheRead: 0.2 },
        contextWindow: 1_000_000,
      }
      const cheapSession = {
        provider: "google",
        id: "gemini-3.6-flash",
        cost: { input: 0.3, output: 2.5, cacheRead: 0.03 },
        contextWindow: 1_000_000,
      }
      const pricedRegistry = {
        getAvailable: () => [pricey],
        find: (provider: string, modelId: string) =>
          [pricey, cheapSession].find((entry) => entry.provider === provider && entry.id === modelId),
      }

      // when
      const result = resolveReflectionModel("quick", { categories: {} }, pricedRegistry, {
        sessionModel: { provider: "google", id: "gemini-3.6-flash" },
      })

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind === "resolved") {
        expect(result.model).toBe("google/gemini-3.6-flash")
        expect(result.source).toBe("session_inherit")
      }
    })

    test("#when the registry scan finds nothing but a session model exists #then reflection inherits the session model", () => {
      // given
      const emptyRegistry = { getAvailable: () => [], find: () => undefined }

      // when
      const result = resolveReflectionModel("quick", { categories: {} }, emptyRegistry, {
        sessionModel: { provider: "anthropic", id: "claude-opus-5", thinking: "low" },
      })

      // then
      expect(result).toEqual({
        kind: "resolved",
        category: "quick",
        model: "anthropic/claude-opus-5",
        thinking: "low",
        source: "session_inherit",
        fallbacks: [],
      })
    })

    test("#when even the registry object is missing #then the session model still resolves", () => {
      // when
      const result = resolveReflectionModel("quick", { categories: {} }, undefined, {
        sessionModel: { provider: "anthropic", id: "claude-opus-5" },
      })

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind === "resolved") {
        expect(result.model).toBe("anthropic/claude-opus-5")
        expect(result.source).toBe("session_inherit")
      }
    })

    test("#when an explicitly pinned model is unresolvable but other models exist #then the fallback keeps reflection alive", () => {
      // A pin that cannot resolve (typo, disconnected provider) still means "run reflection",
      // unlike disable:true which means "do not run" - so the ladder applies and the chosen
      // model is reported as registry_fallback rather than silently masquerading as the pin.
      const result = resolveReflectionModel(
        "quick",
        { categories: { quick: { model: "google/ghost-model" } } },
        liveRegistry,
      )

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind === "resolved") {
        expect(result.model).toBe("google/gemini-3.6-flash")
        expect(result.source).toBe("registry_fallback")
      }
    })

    test("#when neither registry nor session model can help #then it still fails closed", () => {
      // when
      const result = resolveReflectionModel("quick", { categories: {} }, { getAvailable: () => [], find: () => undefined })

      // then
      expect(result.kind).toBe("category_unavailable")
    })
  })

  test("#given the task warning suppression convention #when evaluated #then global opt-out and per-category opt-in retain their precedence", () => {
    // given
    const globallySuppressed: OmoConfig = {
      task: OmoTaskSettingsSchema.parse({ warnings: { unavailable_categories: false } }),
    }
    const categoryOptIn: OmoConfig = {
      task: OmoTaskSettingsSchema.parse({ warnings: { unavailable_categories: false } }),
      categories: { quick: { warn_unavailable: true } },
    }

    // when / then
    expect(shouldWarnCategoryUnavailable(globallySuppressed, "quick")).toBe(false)
    expect(shouldWarnCategoryUnavailable(categoryOptIn, "quick")).toBe(true)
    expect(shouldWarnCategoryUnavailable({ categories: { quick: { model: "missing/model" } } }, "quick")).toBe(false)
  })

  test("#given a pinned user model whose model id contains a slash #when the availability snapshot is stale #then the whole model id is looked up rather than its first segment", () => {
    // given: apitopia publishes the model id "z-ai/glm-5.2-ultrafast-unlocked", which itself contains a
    // slash, and the availability snapshot is still empty when reflection resolves the pin.
    const slashed: SenpiModelPort = { provider: "apitopia", id: "z-ai/glm-5.2-ultrafast-unlocked" }
    const lookups: { readonly provider: string; readonly modelId: string }[] = []
    const staleRegistry = {
      getAvailable: () => [],
      find: (provider: string, modelId: string) => {
        lookups.push({ provider, modelId })
        return provider === slashed.provider && modelId === slashed.id ? slashed : undefined
      },
    }
    const config: OmoConfig = {
      categories: { quick: { model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked" } },
    }

    // when
    const result = resolveReflectionModel("quick", config, staleRegistry)

    // then: the pin resolves, and no lookup ever truncated the model id at its first slash
    expect(result).toEqual({
      kind: "resolved",
      category: "quick",
      model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked",
      fallbacks: [],
    })
    expect(lookups).not.toContainEqual({ provider: "apitopia", modelId: "z-ai" })
  })
})
