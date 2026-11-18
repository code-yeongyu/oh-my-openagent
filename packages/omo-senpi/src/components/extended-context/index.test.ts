import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseJsonc } from "@oh-my-opencode/utils"

import { registerExtendedContextCommand, type ExtendedContextCommandContext } from "./index"

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

  it("#given a user-set window on a matching model #when toggled #then the user's window survives", async () => {
    writeFileSync(modelsPath(), JSON.stringify({
      providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 300_000 } } } },
    }))
    const handler = captureHandler("2026.11.2-3", { models: [{ slug: "gpt-6.1-sol", max_context_window: 872_000 }] })
    await handler("on", context())
    await handler("off", context())
    expect(readModels()).toEqual({
      providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 300_000 } } } },
    })
  })

  it("#given an invalid providers shape #when enabled #then the original bytes remain", async () => {
    const original = '{"providers":5}'
    writeFileSync(modelsPath(), original)
    const handler = captureHandler("2026.11.2-3", { models: [{ slug: "gpt-6.1-sol", max_context_window: 872_000 }] })
    await handler("on", context())
    expect(readFileSync(modelsPath(), "utf8")).toBe(original)
  })

  it("#given a typo in the argument #when invoked #then it does not change configuration", async () => {
    const handler = captureHandler("2026.11.2-3", { models: [{ slug: "gpt-6.1-sol", max_context_window: 872_000 }] })
    await handler("of", context())
    expect(() => readModels()).toThrow()
  })

  it("#given a commented models file #when enabled and disabled #then comments survive", async () => {
    writeFileSync(modelsPath(), '{\n  // Keep this note\n  "providers": {}\n}\n')
    const handler = captureHandler("2026.11.2-3", { models: [{ slug: "gpt-6.1-sol", max_context_window: 872_000 }] })
    await handler("on", context())
    expect(parseJsonc(readFileSync(modelsPath(), "utf8"))).toEqual({
      providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } },
    })
    await handler("off", context())
    expect(readFileSync(modelsPath(), "utf8")).toContain("// Keep this note")
    expect(parseJsonc(readFileSync(modelsPath(), "utf8"))).toEqual({ providers: {} })
  })

  it("#given a private models file #when enabled #then its permissions remain private", async () => {
    writeFileSync(modelsPath(), '{"providers":{}}')
    chmodSync(modelsPath(), 0o600)
    const mode = statSync(modelsPath()).mode & 0o777
    const handler = captureHandler("2026.11.2-3", { models: [{ slug: "gpt-6.1-sol", max_context_window: 872_000 }] })
    await handler("on", context())
    expect(statSync(modelsPath()).mode & 0o777).toBe(mode)
    expect(readModels()).toEqual({
      providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } },
    })
  })

  it.each([
    ["malformed JSON", "on", "{ broken "],
    ["malformed JSON", "off", "{ broken "],
    ["invalid structure", "on", '{"version":1,"provider":"chatgpt-subscription","windows":"bad"}'],
    ["invalid structure", "off", '{"version":1,"provider":"chatgpt-subscription","windows":"bad"}'],
  ])("#given %s in the record #when %s is requested #then it identifies the record and leaves both files unchanged", async (_kind, command, record) => {
    const original = '{"providers":{}}'
    const recordPath = join(dir, "extended-context.json")
    writeFileSync(modelsPath(), original)
    writeFileSync(recordPath, record)
    const handler = captureHandler("2026.11.2-3", { models: [{ slug: "gpt-6.1-sol", max_context_window: 872_000 }] })
    const message = await handler(command, context())
    expect(message).toContain(recordPath)
    expect(readFileSync(modelsPath(), "utf8")).toBe(original)
    expect(readFileSync(recordPath, "utf8")).toBe(record)
  })

  it("#given an earlier managed window #when a second model is enabled #then off removes both", async () => {
    const handler = captureHandler("2026.11.2-3", { models: [
      { slug: "gpt-6.1-sol", max_context_window: 872_000 },
      { slug: "gpt-6-sol", max_context_window: 872_000 },
    ] })
    const registry = {
      getAll: () => [{ id: "gpt-6.1-sol", provider: "chatgpt-subscription", contextWindow: 500_000, maxTokens: 128_000 }],
      getApiKeyForProvider: async () => "token",
    }
    await handler("on", { agentDir: dir, modelRegistry: registry })
    registry.getAll = () => [
      { id: "gpt-6.1-sol", provider: "chatgpt-subscription", contextWindow: 744_000, maxTokens: 128_000 },
      { id: "gpt-6-sol", provider: "chatgpt-subscription", contextWindow: 400_000, maxTokens: 128_000 },
    ]
    await handler("on", { agentDir: dir, modelRegistry: registry })
    await handler("off", { agentDir: dir, modelRegistry: registry })
    expect(readModels()).toEqual({ providers: {} })
  })

  it("#given a catalog request failure #when enabled #then it leaves the file untouched", async () => {
    const original = '{"providers":{}}'
    writeFileSync(modelsPath(), original)
    let handler: Handler | undefined
    registerExtendedContextCommand(
      { registerCommand: (_name: string, options: Record<string, unknown>) => { handler = options.handler as Handler } } as never,
      { hostVersion: "2026.11.5-1", fetchImpl: async () => new Response(null, { status: 503 }) },
    )
    if (handler === undefined) throw new Error("command was not registered")
    await handler("on", context())
    expect(readFileSync(modelsPath(), "utf8")).toBe(original)
  })

  it("#given a host version #when the catalog is requested #then the request uses that identity", async () => {
    let requestUrl = ""
    const userAgents: (string | null)[] = []
    let handler: Handler | undefined
    registerExtendedContextCommand(
      { registerCommand: (_name: string, options: Record<string, unknown>) => { handler = options.handler as Handler } } as never,
      {
        hostVersion: "2026.11.5-1",
        fetchImpl: async (input, init) => {
          requestUrl = String(input)
          userAgents.push(new Headers(init?.headers).get("User-Agent"))
          return new Response(JSON.stringify({ models: [] }))
        },
      },
    )
    if (handler === undefined) throw new Error("command was not registered")
    await handler("on", context())
    expect(new URL(requestUrl).searchParams.get("client_version")).toBe("2026.11.5-1")
    expect(userAgents).toEqual(["omo/2026.11.5-1"])
  })

  it("#given a provider name that would become invalid alone #when disabled #then its contents survive", async () => {
    const config = {
      providers: { "chatgpt-subscription": { name: "My name", modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } },
    }
    writeFileSync(modelsPath(), JSON.stringify(config))
    writeFileSync(join(dir, "extended-context.json"), JSON.stringify({
      version: 1, provider: "chatgpt-subscription", windows: { "gpt-6.1-sol": 744_000 },
    }))
    const handler = captureHandler("2026.11.2-3", { models: [] })
    await handler("off", context())
    expect(readModels()).toEqual(config)
  })

  it("#given a models file edited during the catalog request #when enabled #then the edit survives", async () => {
    writeFileSync(modelsPath(), '{"providers":{}}')
    const edited = '{"providers":{"other":{"apiKey":"new"}}}'
    let handler: Handler | undefined
    registerExtendedContextCommand(
      { registerCommand: (_name: string, options: Record<string, unknown>) => { handler = options.handler as Handler } } as never,
      { hostVersion: "2026.11.5-1", fetchImpl: async () => {
        writeFileSync(modelsPath(), edited)
        return new Response(JSON.stringify({ models: [{ slug: "gpt-6.1-sol", max_context_window: 872_000 }] }))
      } },
    )
    if (handler === undefined) throw new Error("command was not registered")
    await handler("on", context())
    expect(readFileSync(modelsPath(), "utf8")).toBe(edited)
    expect(existsSync(join(dir, "extended-context.json"))).toBe(false)
  })

  it("#given a comment inside the last managed override #when disabled #then the comment is not deleted", async () => {
    const original = `{
      "providers": {
        "chatgpt-subscription": {
          "modelOverrides": {
            "gpt-6.1-sol": {
              // Keep this model note
              "contextWindow": 744000
            }
          }
        }
      }
    }`
    writeFileSync(modelsPath(), original)
    writeFileSync(join(dir, "extended-context.json"), JSON.stringify({
      version: 1, provider: "chatgpt-subscription", windows: { "gpt-6.1-sol": 744_000 },
    }))
    const handler = captureHandler("2026.11.2-3", { models: [] })
    await handler("off", context())
    expect(readFileSync(modelsPath(), "utf8")).toContain("// Keep this model note")
  })

  it("#given another toggle is writing #when invoked concurrently #then it cannot change the models file", async () => {
    const started = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    let requests = 0
    let handler: Handler | undefined
    registerExtendedContextCommand(
      { registerCommand: (_name: string, options: Record<string, unknown>) => { handler = options.handler as Handler } } as never,
      { hostVersion: "2026.11.5-1", fetchImpl: async () => {
        requests += 1
        if (requests === 1) {
          started.resolve(undefined)
          await finish.promise
        }
        return new Response(JSON.stringify({ models: [{ slug: "gpt-6.1-sol", max_context_window: 872_000 }] }))
      } },
    )
    if (handler === undefined) throw new Error("command was not registered")
    const first = handler("on", context())
    try {
      const deadline = AbortSignal.timeout(5_000)
      await Promise.race([
        started.promise,
        new Promise<never>((_resolve, reject) => deadline.addEventListener("abort", () => reject(new Error("catalog request did not start")), { once: true })),
      ])
      await handler("on", context())
      expect(() => readModels()).toThrow()
    } finally {
      finish.resolve(undefined)
      await first
    }
  })
})
