import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { registerExtendedContextCommand, type ExtendedContextCommandContext } from "./index"
import { applyContextWindowOverrides, clearContextWindowOverrides, readModelsJsonConfig } from "./store"
import { computeWidenedWindows, matchReportedSlug, parseReportedWindows } from "./windows"

const reported = parseReportedWindows({
  models: [
    { slug: "gpt-6.1-sol", context_window: 500_000, max_context_window: 872_000 },
    { slug: "gpt-6-luna", context_window: 922_000, max_context_window: 872_000 },
    { slug: "gpt-5.3-codex", context_window: 272_000, max_context_window: 872_000 },
    { slug: "", context_window: 1, max_context_window: 1 },
    { slug: "broken" },
  ],
})

describe("parseReportedWindows", () => {
  it("#given a payload with unusable rows #when parsed #then only rows with a slug and a maximum survive", () => {
    expect(reported.map((window) => window.slug)).toEqual(["gpt-6.1-sol", "gpt-6-luna", "gpt-5.3-codex"])
  })

  it("#given a non-object payload #when parsed #then it yields no windows", () => {
    expect(parseReportedWindows("nope")).toEqual([])
    expect(parseReportedWindows(undefined)).toEqual([])
  })
})

describe("matchReportedSlug", () => {
  const slugs = ["gpt-6.1-sol", "gpt-5.3-codex"]

  it("#given a clone id #when matched #then the catalog variant suffix maps to its base", () => {
    expect(matchReportedSlug("gpt-6.1-sol-ultrafast", ["gpt-6.1-sol-ultrafast", ...slugs])).toBe("gpt-6.1-sol-ultrafast")
    expect(matchReportedSlug("gpt-6.1-sol-fast", slugs)).toBe("gpt-6.1-sol")
  })

  it("#given a sibling that only shares a prefix #when matched #then it is not given the parent's window", () => {
    expect(matchReportedSlug("gpt-5.3-codex-spark", slugs)).toBeUndefined()
  })

  it("#given an unrelated id #when matched #then nothing matches", () => {
    expect(matchReportedSlug("gpt-5.6-terra", slugs)).toBeUndefined()
  })
})

describe("computeWidenedWindows", () => {
  it("#given a reported maximum above the catalog window #when computed #then the output reserve is subtracted", () => {
    const widened = computeWidenedWindows(
      [{ id: "gpt-6.1-sol", contextWindow: 500_000, maxTokens: 128_000 }],
      reported,
    )
    expect(widened).toEqual([{ id: "gpt-6.1-sol", slug: "gpt-6.1-sol", from: 500_000, to: 744_000 }])
  })

  it("#given a catalog window above the reported maximum #when computed #then it is never lowered", () => {
    expect(
      computeWidenedWindows([{ id: "gpt-6-luna", contextWindow: 922_000, maxTokens: 128_000 }], reported),
    ).toEqual([])
  })

  it("#given a model the subscription does not report #when computed #then it is left alone", () => {
    expect(
      computeWidenedWindows([{ id: "gpt-5.6-terra", contextWindow: 272_000, maxTokens: 128_000 }], reported),
    ).toEqual([])
  })
})

describe("models.json overrides", () => {
  const widened = [{ id: "gpt-6.1-sol", slug: "gpt-6.1-sol", from: 500_000, to: 744_000 }]

  it("#given a provider with another override #when applied #then only contextWindow is added", () => {
    const { config, written } = applyContextWindowOverrides(
      { providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { maxTokens: 64_000 } } } } },
      "chatgpt-subscription",
      widened,
    )
    expect(config.providers?.["chatgpt-subscription"]?.modelOverrides?.["gpt-6.1-sol"]).toEqual({
      maxTokens: 64_000,
      contextWindow: 744_000,
    })
    expect(written).toEqual({ "gpt-6.1-sol": 744_000 })
  })

  it("#given an override the command did not write #when cleared #then the user's value survives", () => {
    const config = {
      providers: {
        "chatgpt-subscription": {
          modelOverrides: {
            "gpt-6.1-sol": { contextWindow: 744_000 },
            "gpt-5.5": { contextWindow: 200_000 },
          },
        },
      },
    }
    const { config: cleared, cleared: ids } = clearContextWindowOverrides(config, "chatgpt-subscription", {
      "gpt-6.1-sol": 744_000,
    })
    expect(ids).toEqual(["gpt-6.1-sol"])
    expect(cleared.providers?.["chatgpt-subscription"]?.modelOverrides).toEqual({
      "gpt-5.5": { contextWindow: 200_000 },
    })
  })

  it("#given the provider held only the written window #when cleared #then the provider goes and providers stays", () => {
    const { config } = clearContextWindowOverrides(
      { providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } } },
      "chatgpt-subscription",
      { "gpt-6.1-sol": 744_000 },
    )
    expect(config).toEqual({ providers: {} })
  })

  it("#given a file that exists but does not parse #when read #then it is reported as invalid rather than empty", () => {
    expect(readModelsJsonConfig("/nonexistent/models.json", false)).toEqual({ kind: "missing", config: {} })
    expect(readModelsJsonConfig("/nonexistent/models.json", true)).toEqual({ kind: "invalid" })
  })
})

type Handler = (args: string, ctx: ExtendedContextCommandContext) => Promise<string>

function captureHandler(hostVersion: string | undefined, payload: unknown): Handler {
  let handler: Handler | undefined
  registerExtendedContextCommand(
    {
      registerCommand: (_name: string, options: Record<string, unknown>) => {
        handler = options.handler as Handler
      },
    } as never,
    {
      hostVersion,
      fetchImpl: (async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch,
    },
  )
  if (handler === undefined) throw new Error("command was not registered")
  return handler
}

describe("the command", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "extended-context-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const context = (): ExtendedContextCommandContext => ({
    agentDir: dir,
    modelRegistry: {
      getAll: () => [
        { id: "gpt-6.1-sol", provider: "chatgpt-subscription", contextWindow: 500_000, maxTokens: 128_000 },
      ],
      getApiKeyForProvider: async () => "token",
    },
  })

  const modelsPath = () => join(dir, "models.json")
  const readModels = () => JSON.parse(readFileSync(modelsPath(), "utf8")) as Record<string, unknown>

  it("#given no models.json #when run #then it writes the widened window and toggles off on the next run", async () => {
    const handler = captureHandler("2026.11.2-3", { models: [{ slug: "gpt-6.1-sol", context_window: 500_000, max_context_window: 872_000 }] })

    await handler("", context())
    expect(readModels()).toEqual({
      providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } },
    })

    await handler("", context())
    expect(readModels()).toEqual({ providers: {} })
  })

  it("#given a models.json that does not parse #when run #then nothing is written", async () => {
    writeFileSync(modelsPath(), "{ broken ")
    const handler = captureHandler("2026.11.2-3", { models: [] })

    const message = await handler("", context())
    expect(message).toContain("does not parse")
    expect(readFileSync(modelsPath(), "utf8")).toBe("{ broken ")
  })

  it("#given no host version #when run #then it refuses instead of inventing one", async () => {
    const handler = captureHandler(undefined, { models: [] })
    expect(await handler("", context())).toContain("does not report its version")
  })

  it("#given no subscription credential #when run #then it asks for a login and writes nothing", async () => {
    const handler = captureHandler("2026.11.2-3", { models: [] })
    const message = await handler("", {
      agentDir: dir,
      modelRegistry: { getAll: () => [], getApiKeyForProvider: async () => undefined },
    })
    expect(message).toContain("/login chatgpt-subscription")
    expect(() => readModels()).toThrow()
  })
})
