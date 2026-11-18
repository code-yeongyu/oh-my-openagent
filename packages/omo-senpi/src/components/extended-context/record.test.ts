import { expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { registerExtendedContextCommand, type ExtendedContextCommandContext } from "./index"
import { beginTransaction } from "./transaction"

type Handler = (args: string, ctx: ExtendedContextCommandContext) => Promise<string>

it("#given an existing record #when another models write fails #then the record is unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "extended-context-record-"))
  try {
    const record = join(dir, "extended-context.json")
    const models = join(dir, "models.json")
    const originalRecord = JSON.stringify({
      version: 1, provider: "chatgpt-subscription", windows: { "gpt-6.1-sol": 744_000 },
    })
    writeFileSync(record, originalRecord)
    writeFileSync(models, JSON.stringify({
      providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } },
    }))
    let handler: Handler | undefined
    registerExtendedContextCommand(
      { registerCommand: (_name: string, options: Record<string, unknown>) => { handler = options.handler as Handler } } as never,
      { hostVersion: "2026.11.5-1", fetchImpl: async () => {
        writeFileSync(models, '{"providers":{"other":{"apiKey":"new"}}}')
        return new Response(JSON.stringify({ models: [{ slug: "gpt-6-sol", max_context_window: 872_000 }] }))
      } },
    )
    if (handler === undefined) throw new Error("command was not registered")

    await handler("on", {
      agentDir: dir,
      modelRegistry: {
        getAll: () => [{ id: "gpt-6-sol", provider: "chatgpt-subscription", contextWindow: 400_000, maxTokens: 128_000 }],
        getApiKeyForProvider: async () => "token",
      },
    })

    expect(readFileSync(record, "utf8")).toBe(originalRecord)
    expect(existsSync(join(dir, "extended-context.pending.json"))).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it("#given the ownership-record write fails #when turned off #then the managed window is restored", async () => {
  const dir = mkdtempSync(join(tmpdir(), "extended-context-record-"))
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, join(import.meta.dir, "fixtures", "fail-record-write.mjs"), dir],
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    })
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (status !== 0) throw new Error(`Record-write fixture failed (${status}): ${stdout}\n${stderr}`)
    const models = join(dir, "models.json")
    expect(JSON.parse(readFileSync(models, "utf8"))).toEqual({
      providers: { "chatgpt-subscription": { modelOverrides: { "fixture-model": { contextWindow: 744_000 } } } },
    })
    let handler: Handler | undefined
    registerExtendedContextCommand({
      registerCommand: (_name: string, options: Record<string, unknown>) => { handler = options.handler as Handler },
    } as never)
    if (handler === undefined) throw new Error("command was not registered")

    await handler("off", { agentDir: dir })

    expect(JSON.parse(readFileSync(models, "utf8"))).toEqual({ providers: {} })
    expect(existsSync(join(dir, "extended-context.pending.json"))).toBe(false)
    expect(existsSync(join(dir, "extended-context.json"))).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it.each(["unchanged", "reordered", "changed"] as const)("#given an inaccessible record and %s models #when turned off #then recovery respects the file", async (state) => {
  const dir = mkdtempSync(join(tmpdir(), "extended-context-record-"))
  try {
    const record = join(dir, "extended-context.json")
    const models = join(dir, "models.json")
    const transaction = join(dir, "extended-context.pending.json")
    const secret = "fixture-secret"
    writeFileSync(models, JSON.stringify({ providers: { other: { apiKey: secret } } }))
    let handler: Handler | undefined
    registerExtendedContextCommand(
      { registerCommand: (_name: string, options: Record<string, unknown>) => { handler = options.handler as Handler } } as never,
      { hostVersion: "2026.11.5-1", fetchImpl: async () => {
        mkdirSync(record)
        return new Response(JSON.stringify({ models: [{ slug: "gpt-6-sol", max_context_window: 872_000 }] }))
      } },
    )
    if (handler === undefined) throw new Error("command was not registered")
    const ctx = {
      agentDir: dir,
      modelRegistry: {
        getAll: () => [{ id: "gpt-6-sol", provider: "chatgpt-subscription", contextWindow: 400_000, maxTokens: 128_000 }],
        getApiKeyForProvider: async () => "token",
      },
    }

    await handler("on", ctx)
    expect(JSON.parse(readFileSync(models, "utf8"))).toEqual({
      providers: {
        other: { apiKey: secret },
        "chatgpt-subscription": { modelOverrides: { "gpt-6-sol": { contextWindow: 744_000 } } },
      },
    })
    expect(readFileSync(transaction, "utf8")).not.toContain(secret)
    rmSync(record, { recursive: true })
    const edited = '{"providers":{"other":{"apiKey":"changed"},"chatgpt-subscription":{"modelOverrides":{"gpt-6-sol":{"contextWindow":744000}}}}}'
    if (state === "changed") writeFileSync(models, edited)
    if (state === "reordered") writeFileSync(models, JSON.stringify({
      providers: {
        "chatgpt-subscription": { modelOverrides: { "gpt-6-sol": { contextWindow: 744_000 } } },
        other: { apiKey: secret },
      },
    }))
    await handler("off", ctx)

    if (state === "changed") {
      expect(readFileSync(models, "utf8")).toBe(edited)
      expect(existsSync(transaction)).toBe(true)
    } else {
      expect(JSON.parse(readFileSync(models, "utf8"))).toEqual({ providers: { other: { apiKey: secret } } })
      expect(existsSync(transaction)).toBe(false)
    }
    expect(existsSync(record)).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it.each(["before", "after", "recorded", "modified"] as const)("#given an interrupted transaction in state %s #when turned off #then recovery preserves ownership", async (state) => {
  const dir = mkdtempSync(join(tmpdir(), "extended-context-record-"))
  try {
    const models = join(dir, "models.json")
    const record = join(dir, "extended-context.json")
    const transaction = join(dir, "extended-context.pending.json")
    const before = {
      providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } },
    }
    const after = {
      providers: { "chatgpt-subscription": { modelOverrides: {
        "gpt-6.1-sol": { contextWindow: 744_000 },
        "gpt-6-sol": { contextWindow: 744_000 },
      } } },
    }
    const previous = { "gpt-6.1-sol": 744_000 }
    const windows = { ...previous, "gpt-6-sol": 744_000 }
    beginTransaction(dir, before, after, previous, windows)
    writeFileSync(models, JSON.stringify(state === "before" ? before : after))
    const changedRecord = JSON.stringify({ version: 1, provider: "chatgpt-subscription", windows: { "user-model": 123_000 } })
    if (state === "before" || state === "after") writeFileSync(record, JSON.stringify({ version: 1, provider: "chatgpt-subscription", windows: previous }))
    if (state === "recorded") writeFileSync(record, JSON.stringify({ version: 1, provider: "chatgpt-subscription", windows }))
    if (state === "modified") writeFileSync(record, changedRecord)
    let handler: Handler | undefined
    registerExtendedContextCommand({
      registerCommand: (_name: string, options: Record<string, unknown>) => { handler = options.handler as Handler },
    } as never)
    if (handler === undefined) throw new Error("command was not registered")

    await handler("off", { agentDir: dir })

    if (state === "modified") {
      expect(JSON.parse(readFileSync(models, "utf8"))).toEqual(after)
      expect(readFileSync(record, "utf8")).toBe(changedRecord)
      expect(existsSync(transaction)).toBe(true)
    } else {
      expect(JSON.parse(readFileSync(models, "utf8"))).toEqual({ providers: {} })
      expect(existsSync(record)).toBe(false)
      expect(existsSync(transaction)).toBe(false)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it("#given a corrupt transaction #when turned off #then it identifies the file and preserves the records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "extended-context-record-"))
  try {
    const models = join(dir, "models.json")
    const record = join(dir, "extended-context.json")
    const transaction = join(dir, "extended-context.pending.json")
    const originalModels = '{"providers":{}}'
    const originalRecord = '{"version":1,"provider":"chatgpt-subscription","windows":{"gpt-6-sol":744000}}'
    const corruptTransaction = "{ broken "
    writeFileSync(models, originalModels)
    writeFileSync(record, originalRecord)
    writeFileSync(transaction, corruptTransaction)
    let handler: Handler | undefined
    registerExtendedContextCommand({
      registerCommand: (_name: string, options: Record<string, unknown>) => { handler = options.handler as Handler },
    } as never)
    if (handler === undefined) throw new Error("command was not registered")

    const message = await handler("off", { agentDir: dir })

    expect(message).toContain(transaction)
    expect(readFileSync(models, "utf8")).toBe(originalModels)
    expect(readFileSync(record, "utf8")).toBe(originalRecord)
    expect(readFileSync(transaction, "utf8")).toBe(corruptTransaction)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
