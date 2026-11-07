import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { registerExtendedContextCommand, type ExtendedContextCommandContext } from "./index"

type Handler = (args: string, ctx: ExtendedContextCommandContext) => Promise<string>

describe("restoring extended context", () => {
  let dir: string
  let handler: Handler

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "extended-context-restore-"))
    let registered: Handler | undefined
    registerExtendedContextCommand({
      registerCommand: (_name: string, options: Record<string, unknown>) => {
        registered = options.handler as Handler
      },
    } as never)
    if (registered === undefined) throw new Error("command was not registered")
    handler = registered
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it.each([
    ["missing file", undefined],
    ["file without providers", '{"other":"value"}'],
  ])("#given a managed record and %s #when disabled #then the record is cleared without writing models", async (_label, original) => {
    const models = join(dir, "models.json")
    const record = join(dir, "extended-context.json")
    if (original !== undefined) writeFileSync(models, original)
    writeFileSync(record, JSON.stringify({
      version: 1, provider: "chatgpt-subscription", windows: { "gpt-6.1-sol": 744_000 },
    }))

    await handler("off", { agentDir: dir })

    expect(existsSync(record)).toBe(false)
    if (original === undefined) expect(existsSync(models)).toBe(false)
    else expect(readFileSync(models, "utf8")).toBe(original)
  })

  it.each([
    ["whitelist", ["gpt-6.1-sol"]],
    ["blacklist", ["gpt-5.5"]],
    ["hideFreeModels", false],
    ["extraBody", { setting: true }],
  ])("#given a provider with %s #when disabled #then its setting survives", async (key, value) => {
    const models = join(dir, "models.json")
    const record = join(dir, "extended-context.json")
    const credentials = { rotation: false }
    writeFileSync(models, JSON.stringify({
      providers: { "chatgpt-subscription": { [key]: value, credentials, modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } },
    }))
    writeFileSync(record, JSON.stringify({
      version: 1, provider: "chatgpt-subscription", windows: { "gpt-6.1-sol": 744_000 },
    }))

    await handler("off", { agentDir: dir })

    expect(JSON.parse(readFileSync(models, "utf8"))).toEqual({ providers: { "chatgpt-subscription": { [key]: value, credentials } } })
    expect(existsSync(record)).toBe(false)
  })

  it.each([
    ["api without a base URL", { api: "openai-completions" }],
    ["empty models with credentials", { models: [], credentials: { rotation: false } }],
  ])("#given %s #when the last override is removed #then the invalid provider is not written", async (_label, fields) => {
    const models = join(dir, "models.json")
    const record = join(dir, "extended-context.json")
    const config = {
      providers: { "chatgpt-subscription": { ...fields, modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } },
    }
    writeFileSync(models, JSON.stringify(config))
    writeFileSync(record, JSON.stringify({
      version: 1, provider: "chatgpt-subscription", windows: { "gpt-6.1-sol": 744_000 },
    }))

    await handler("off", { agentDir: dir })

    expect(JSON.parse(readFileSync(models, "utf8"))).toEqual(config)
    expect(existsSync(record)).toBe(true)
  })

  it("#given an otherwise empty models list #when disabled #then the managed provider is removed", async () => {
    const models = join(dir, "models.json")
    const record = join(dir, "extended-context.json")
    writeFileSync(models, JSON.stringify({
      providers: { "chatgpt-subscription": { models: [], modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } },
    }))
    writeFileSync(record, JSON.stringify({
      version: 1, provider: "chatgpt-subscription", windows: { "gpt-6.1-sol": 744_000 },
    }))

    await handler("off", { agentDir: dir })

    expect(JSON.parse(readFileSync(models, "utf8"))).toEqual({ providers: {} })
    expect(existsSync(record)).toBe(false)
  })

  it("#given a comment in an empty models list #when disabled #then it preserves the file and record", async () => {
    const models = join(dir, "models.json")
    const record = join(dir, "extended-context.json")
    const original = '{"providers":{"chatgpt-subscription":{"models":[/* keep */],"modelOverrides":{"gpt-6.1-sol":{"contextWindow":744000}}}}}'
    writeFileSync(models, original)
    writeFileSync(record, JSON.stringify({
      version: 1, provider: "chatgpt-subscription", windows: { "gpt-6.1-sol": 744_000 },
    }))

    await handler("off", { agentDir: dir })

    expect(readFileSync(models, "utf8")).toBe(original)
    expect(existsSync(record)).toBe(true)
  })
})
