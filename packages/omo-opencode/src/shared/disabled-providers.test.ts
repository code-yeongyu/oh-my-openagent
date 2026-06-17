import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS } from "@oh-my-opencode/model-core";
/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import {
  applyDisabledProviders,
  filterDisabledProviderModels,
  getModelProvider,
  isProviderDisabled,
} from "./disabled-providers"
import { clearConfigLoadErrors, getConfigLoadErrors } from "./config-errors"
import type { OhMyOpenCodeConfig } from "../config"

beforeEach(() => {
  clearConfigLoadErrors()
})

describe("getModelProvider", () => {
  test("returns the first segment before the slash", () => {
    expect(getModelProvider("github-copilot/gpt-5.5")).toBe(SUPPORTED_PROVIDERS.GITHUB_COPILOT)
    expect(getModelProvider("anthropic/claude-opus-4-7")).toBe(SUPPORTED_PROVIDERS.ANTHROPIC)
    expect(getModelProvider("vercel/openai/gpt-5.5")).toBe(SUPPORTED_PROVIDERS.VERCEL)
  })

  test("trims provider whitespace before returning", () => {
    expect(getModelProvider(" github-copilot/gpt-5.5")).toBe(SUPPORTED_PROVIDERS.GITHUB_COPILOT)
    expect(getModelProvider("github-copilot /gpt-5.5")).toBe(SUPPORTED_PROVIDERS.GITHUB_COPILOT)
  })

  test("returns undefined when the string has no provider prefix", () => {
    expect(getModelProvider(SUPPORTED_MODELS.GPT_5_5)).toBeUndefined()
    expect(getModelProvider("")).toBeUndefined()
    expect(getModelProvider("/foo")).toBeUndefined()
  })
})

describe("isProviderDisabled", () => {
  test("returns true only when the model's provider exactly matches a disabled entry", () => {
    expect(isProviderDisabled("github-copilot/foo", [SUPPORTED_PROVIDERS.GITHUB_COPILOT])).toBe(true)
    expect(isProviderDisabled("github-copilot-extra/foo", [SUPPORTED_PROVIDERS.GITHUB_COPILOT])).toBe(false)
    expect(isProviderDisabled("opencode-go/glm-5.1", [SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.VERCEL])).toBe(false)
  })

  test("short-circuits when the disabled list is empty", () => {
    expect(isProviderDisabled("github-copilot/foo", [])).toBe(false)
  })

  test("handles undefined model", () => {
    expect(isProviderDisabled(undefined, [SUPPORTED_PROVIDERS.GITHUB_COPILOT])).toBe(false)
  })

  test("is case-insensitive: matches regardless of casing on either side", () => {
    expect(isProviderDisabled("GitHub-Copilot/gpt-5.5", [SUPPORTED_PROVIDERS.GITHUB_COPILOT])).toBe(true)
    expect(isProviderDisabled("github-copilot/gpt-5.5", ["GitHub-Copilot"])).toBe(true)
    expect(isProviderDisabled("OPENAI/gpt-5.5", [SUPPORTED_PROVIDERS.OPENAI])).toBe(true)
    expect(isProviderDisabled("openai/gpt-5.5", ["VERCEL"])).toBe(false)
  })

  test("trims provider and disabled-list entries before comparing", () => {
    expect(isProviderDisabled(" github-copilot/gpt-5.5", [SUPPORTED_PROVIDERS.GITHUB_COPILOT])).toBe(true)
    expect(isProviderDisabled("github-copilot /gpt-5.5", [" github-copilot "])).toBe(true)
  })
})

describe("filterDisabledProviderModels", () => {
  test("preserves entries whose provider is not disabled, dropping the rest", () => {
    const input = [
      "github-copilot/gpt-5.5",
      "openai/gpt-5.5",
      { model: "vercel/openai/gpt-5.5", variant: SUPPORTED_VARIANTS.MEDIUM },
      { model: "opencode/gpt-5.5", variant: SUPPORTED_VARIANTS.MEDIUM },
    ]
    const result = filterDisabledProviderModels(input, [SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.VERCEL])
    expect(result).toEqual([
      "openai/gpt-5.5",
      { model: "opencode/gpt-5.5", variant: SUPPORTED_VARIANTS.MEDIUM },
    ])
  })

  test("returns a fresh copy when the disabled list is empty", () => {
    const input = ["openai/gpt-5.5"]
    const result = filterDisabledProviderModels(input, [])
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
  })
})

describe("applyDisabledProviders", () => {
  test("no-op when disabled_providers is unset or empty", () => {
    const config = {
      agents: {
        hephaestus: {
          model: "github-copilot/gpt-5.5",
          fallback_models: ["github-copilot/gpt-5.4-mini", "openai/gpt-5.5"],
        },
      },
    } as unknown as OhMyOpenCodeConfig

    applyDisabledProviders(config)
    const agents = config.agents as Record<string, { model?: string; fallback_models?: unknown }>
    expect(agents.hephaestus.model).toBe("github-copilot/gpt-5.5")
    expect(agents.hephaestus.fallback_models).toEqual(["github-copilot/gpt-5.4-mini", "openai/gpt-5.5"])
  })

  test("filters fallback chain and substitutes primary from the first allowed entry", () => {
    const config = {
      disabled_providers: [SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.VERCEL],
      agents: {
        hephaestus: {
          model: "github-copilot/gpt-5.5",
          fallback_models: [
            "github-copilot/gpt-5.4-mini",
            { model: "openai/gpt-5.5", variant: SUPPORTED_VARIANTS.MEDIUM },
            { model: "vercel/openai/gpt-5.5", variant: SUPPORTED_VARIANTS.MEDIUM },
            "opencode/gpt-5.5",
          ],
        },
        sisyphus: {
          model: "anthropic/claude-opus-4-7",
          fallback_models: [{ model: "github-copilot/claude-sonnet-4.6" }, "opencode-go/glm-5.1"],
        },
      },
    } as unknown as OhMyOpenCodeConfig

    applyDisabledProviders(config)

    const agents = config.agents as Record<string, { model?: string; fallback_models?: unknown }>
    expect(agents.hephaestus.model).toBe("openai/gpt-5.5")
    expect(agents.hephaestus.fallback_models).toEqual([
      { model: "openai/gpt-5.5", variant: SUPPORTED_VARIANTS.MEDIUM },
      "opencode/gpt-5.5",
    ])

    expect(agents.sisyphus.model).toBe("anthropic/claude-opus-4-7")
    expect(agents.sisyphus.fallback_models).toEqual(["opencode-go/glm-5.1"])
  })

  test("leaves primary unchanged but records a config-load error when every chain entry is also disabled", () => {
    const config = {
      disabled_providers: [SUPPORTED_PROVIDERS.GITHUB_COPILOT],
      agents: {
        oracle: {
          model: "github-copilot/gpt-5.5",
          fallback_models: ["github-copilot/gpt-5.4-mini", { model: "github-copilot/gemini-3" }],
        },
      },
    } as unknown as OhMyOpenCodeConfig

    applyDisabledProviders(config)

    const agents = config.agents as Record<string, { model?: string; fallback_models?: unknown }>
    expect(agents.oracle.model).toBe("github-copilot/gpt-5.5")
    // Empty chain is normalized to undefined so "no chain declared" and
    // "empty chain declared" stay semantically distinct downstream.
    expect(agents.oracle.fallback_models).toBeUndefined()

    const errors = getConfigLoadErrors()
    expect(errors.length).toBe(1)
    expect(errors[0]!.path).toBe("disabled_providers:agents.oracle")
    expect(errors[0]!.error).toContain("github-copilot/gpt-5.5")
    expect(errors[0]!.error).toContain("disabled provider")
  })

  test("treats provider names case-insensitively across primary and chain entries", () => {
    const config = {
      disabled_providers: ["GitHub-Copilot"],
      agents: {
        hephaestus: {
          model: "github-copilot/gpt-5.5",
          fallback_models: [
            "GITHUB-COPILOT/gpt-5.4-mini",
            "openai/gpt-5.5",
          ],
        },
      },
    } as unknown as OhMyOpenCodeConfig

    applyDisabledProviders(config)

    const agents = config.agents as Record<string, { model?: string; fallback_models?: unknown }>
    expect(agents.hephaestus.model).toBe("openai/gpt-5.5")
    expect(agents.hephaestus.fallback_models).toEqual(["openai/gpt-5.5"])
  })

  test("applies the same rules to categories", () => {
    const config = {
      disabled_providers: [SUPPORTED_PROVIDERS.GITHUB_COPILOT],
      categories: {
        deep: {
          model: "github-copilot/gpt-5.5",
          fallback_models: ["openai/gpt-5.5", "github-copilot/claude-sonnet-4.6"],
        },
      },
    } as unknown as OhMyOpenCodeConfig

    applyDisabledProviders(config)

    const cats = config.categories as Record<string, { model?: string; fallback_models?: unknown }>
    expect(cats.deep.model).toBe("openai/gpt-5.5")
    expect(cats.deep.fallback_models).toEqual(["openai/gpt-5.5"])
  })
})
