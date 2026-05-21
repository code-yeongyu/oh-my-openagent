import { beforeEach, describe, expect, mock, test } from "bun:test"

mock.module("./logger", () => ({ log: (..._args: unknown[]) => {} }))

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
    expect(getModelProvider("github-copilot/gpt-5.5")).toBe("github-copilot")
    expect(getModelProvider("anthropic/claude-opus-4-7")).toBe("anthropic")
    expect(getModelProvider("vercel/openai/gpt-5.5")).toBe("vercel")
  })

  test("returns undefined when the string has no provider prefix", () => {
    expect(getModelProvider("gpt-5.5")).toBeUndefined()
    expect(getModelProvider("")).toBeUndefined()
    expect(getModelProvider("/foo")).toBeUndefined()
  })
})

describe("isProviderDisabled", () => {
  test("returns true only when the model's provider exactly matches a disabled entry", () => {
    expect(isProviderDisabled("github-copilot/foo", ["github-copilot"])).toBe(true)
    expect(isProviderDisabled("github-copilot-extra/foo", ["github-copilot"])).toBe(false)
    expect(isProviderDisabled("opencode-go/glm-5.1", ["github-copilot", "vercel"])).toBe(false)
  })

  test("short-circuits when the disabled list is empty", () => {
    expect(isProviderDisabled("github-copilot/foo", [])).toBe(false)
  })

  test("handles undefined model", () => {
    expect(isProviderDisabled(undefined, ["github-copilot"])).toBe(false)
  })

  test("is case-insensitive: matches regardless of casing on either side", () => {
    expect(isProviderDisabled("GitHub-Copilot/gpt-5.5", ["github-copilot"])).toBe(true)
    expect(isProviderDisabled("github-copilot/gpt-5.5", ["GitHub-Copilot"])).toBe(true)
    expect(isProviderDisabled("OPENAI/gpt-5.5", ["openai"])).toBe(true)
    expect(isProviderDisabled("openai/gpt-5.5", ["VERCEL"])).toBe(false)
  })
})

describe("filterDisabledProviderModels", () => {
  test("preserves entries whose provider is not disabled, dropping the rest", () => {
    const input = [
      "github-copilot/gpt-5.5",
      "openai/gpt-5.5",
      { model: "vercel/openai/gpt-5.5", variant: "medium" },
      { model: "opencode/gpt-5.5", variant: "medium" },
    ]
    const result = filterDisabledProviderModels(input, ["github-copilot", "vercel"])
    expect(result).toEqual([
      "openai/gpt-5.5",
      { model: "opencode/gpt-5.5", variant: "medium" },
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
      disabled_providers: ["github-copilot", "vercel"],
      agents: {
        hephaestus: {
          model: "github-copilot/gpt-5.5",
          fallback_models: [
            "github-copilot/gpt-5.4-mini",
            { model: "openai/gpt-5.5", variant: "medium" },
            { model: "vercel/openai/gpt-5.5", variant: "medium" },
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
      { model: "openai/gpt-5.5", variant: "medium" },
      "opencode/gpt-5.5",
    ])

    expect(agents.sisyphus.model).toBe("anthropic/claude-opus-4-7")
    expect(agents.sisyphus.fallback_models).toEqual(["opencode-go/glm-5.1"])
  })

  test("leaves primary unchanged but records a config-load error when every chain entry is also disabled", () => {
    const config = {
      disabled_providers: ["github-copilot"],
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
      disabled_providers: ["github-copilot"],
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
