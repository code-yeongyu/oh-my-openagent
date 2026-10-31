import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./resolver"

function registry(available: readonly string[], catalog = available) {
  const port = (selector: string) => {
    const slash = selector.indexOf("/")
    return { provider: selector.slice(0, slash), id: selector.slice(slash + 1) }
  }
  return {
    getAvailable: () => available.map(port),
    getAll: () => catalog.map(port),
    find: (provider: string, id: string) => catalog.includes(`${provider}/${id}`) ? { provider, id } : undefined,
  }
}

describe("bare category pins (#9503)", () => {
  test.each(["model", "models"] as const)("qualifies a served bare %s pin and preserves reasoning", (key) => {
    const config = key === "model"
      ? { model: "deepseek-v4-flash", reasoning: "high" as const }
      : { models: [{ model: "deepseek-v4-flash", reasoning: "high" as const }] }
    const result = resolveCategory("quick", { categories: { quick: config } }, registry(["opencode-go/deepseek-v4-flash"]))
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error(result.kind)
    expect(result.spec).toMatchObject({ provider: "opencode-go", modelId: "deepseek-v4-flash", reasoningEffort: "high" })
  })

  test("equal serving models choose lexicographic provider order, not registry order", () => {
    for (const available of [["z-provider/flash", "a-provider/flash"], ["a-provider/flash", "z-provider/flash"]]) {
      const result = resolveCategory("quick", { categories: { quick: { model: "flash" } } }, registry(available))
      expect(result.kind === "resolved" && result.spec.provider).toBe("a-provider")
    }
  })

  test("unserved bare pin recovers to category default and names catalog serving providers", () => {
    const result = resolveCategory("quick", { categories: { quick: { model: "deepseek-v4-flash" } } },
      registry(["deepseek/deepseek-flash"], ["opencode-go/deepseek-v4-flash", "deepseek/deepseek-flash"]))
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error(result.kind)
    expect(result.spec).toMatchObject({ provider: "deepseek", modelId: "deepseek-flash" })
    expect(result).toMatchObject({ pinUnserved: { pin: "deepseek-v4-flash", providers: ["opencode-go"] } })
  })

  test("unserved bare pin with no category default retains an actionable state", () => {
    const result = resolveCategory("quick", { categories: { quick: { model: "ghost" } } }, registry(["other/frontier"]))
    expect(result.kind).toBe("model_unavailable")
    expect(result).toMatchObject({ pinUnserved: { pin: "ghost", providers: [] } })
  })

  test("an empty connected set cannot recover through an unconnected catalog default", () => {
    const result = resolveCategory("quick", { categories: { quick: { model: "ghost" } } },
      registry([], ["openai/gpt-5.6-luna-fast"]))
    expect(result).toMatchObject({ kind: "model_unavailable", pinUnserved: { pin: "ghost" } })
  })

  test("qualified pins keep their selected provider unchanged", () => {
    const result = resolveCategory("quick", { categories: { quick: { model: "z-provider/flash" } } },
      registry(["a-provider/flash", "z-provider/flash"]))
    expect(result.kind === "resolved" && result.spec.provider).toBe("z-provider")
  })

  test("bare suffix is parsed before qualification and exact ids beat partial matches", () => {
    const result = resolveCategory("quick", { categories: { quick: { model: "flash high" } } },
      registry(["a-provider/flash-preview", "z-provider/flash"]))
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error(result.kind)
    expect(result.spec).toMatchObject({ provider: "z-provider", modelId: "flash", variant: "high" })
  })

  test.each(["a-provider/flash-preview", "flash/unrelated"])("does not mistake %s for a serving model", (selector) => {
    const result = resolveCategory("quick", { categories: { quick: { model: "flash" } } }, registry([selector]))
    expect(result).toMatchObject({ kind: "model_unavailable", pinUnserved: { pin: "flash", providers: [] } })
  })

  test("unserved canonical pin names the effective setting and preserves default retry rungs", () => {
    const result = resolveCategory("quick", { categories: { quick: { models: ["ghost"] } } },
      registry(["deepseek/deepseek-flash", "zai/glm-5.3-flash"]))
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error(result.kind)
    expect(result.pinUnserved).toMatchObject({ setting: "categories.quick.models[0]" })
    expect(result.spec.fallback_models?.length).toBeGreaterThan(0)
  })

  test("excluded serving lanes neither win nor appear in the diagnostic", () => {
    const result = resolveCategory("quick", { exclude_models: ["opencode-go/*"], categories: { quick: { model: "deepseek-v4-flash" } } },
      registry(["opencode-go/deepseek-v4-flash", "deepseek/deepseek-flash"]))
    expect(result).toMatchObject({ kind: "resolved", pinUnserved: { providers: [] } })
  })

  test("qualified canonical chain preserves bare fallback reasoning", () => {
    const result = resolveCategory("quick", { categories: { quick: { models: [
      { model: "a-provider/primary", reasoning: "high" },
      { model: "flash", reasoning: "off" },
    ] } } }, registry(["a-provider/primary", "z-provider/flash"]))
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error(result.kind)
    expect(result.spec.fallback_models).toMatchObject([{ provider: "z-provider", model_id: "flash", reasoning_effort: "off" }])
  })
})
