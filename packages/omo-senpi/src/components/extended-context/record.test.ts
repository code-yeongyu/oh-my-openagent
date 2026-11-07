import { expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { registerExtendedContextCommand, type ExtendedContextCommandContext } from "./index"

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
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
