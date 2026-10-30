/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { customModelProviders } from "./custom-providers"
import { resolveModelProfile } from "./resolve"

const dirs: string[] = []

function agentDirWith(modelsJson: string): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-custom-providers-"))
  dirs.push(dir)
  writeFileSync(join(dir, "models.json"), modelsJson)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("customModelProviders", () => {
  it("#given models.json providers with their own models #when read #then lists them in declaration order", () => {
    const dir = agentDirWith(`{
      // JSONC, as senpi parses it
      "providers": {
        "proxy-b": { "baseUrl": "https://b.example/v1", "models": [{ "id": "claude-opus-5-5" }] },
        "anthropic": { "baseUrl": "https://override.example" },
        "proxy-a": { "models": [{ "id": "claude-opus-5-5" }, { "id": "glm-5.3" }] },
        "empty": { "models": [] },
        "malformed": { "models": [{}, { "id": 7 }, { "id": "" }] },
      },
    }`)

    expect(customModelProviders(dir)).toEqual([
      { provider: "proxy-b", modelIds: ["claude-opus-5-5"] },
      { provider: "proxy-a", modelIds: ["claude-opus-5-5", "glm-5.3"] },
    ])
  })

  // Security contract (#9146): models.json entries are merged into a built-in provider's catalog, so a
  // gateway the user extends with one model must not serve a builtin rung id the user never declared.
  it("#given a gateway extended in models.json with an unrelated model #when a builtin lane resolves #then the gateway's catalog copy of the rung id is not used", () => {
    const dir = agentDirWith(`{ "providers": { "openrouter": { "models": [{ "id": "my-finetune" }] } } }`)

    const result = resolveModelProfile({
      active: "daily-normal",
      availableModels: ["openrouter/claude-opus-5-5", "openrouter/my-finetune"],
      customProviders: customModelProviders(dir),
    })

    expect(result.kind).toBe("unavailable")
  })

  it("#given the same gateway declaring the rung id itself #when a builtin lane resolves #then it serves the lane", () => {
    const dir = agentDirWith(`{ "providers": { "openrouter": { "models": [{ "id": "claude-opus-5-5" }] } } }`)

    const result = resolveModelProfile({
      active: "daily-normal",
      availableModels: ["openrouter/claude-opus-5-5"],
      customProviders: customModelProviders(dir),
    })

    expect(result).toMatchObject({ kind: "resolved", provider: "openrouter", modelId: "claude-opus-5-5" })
  })

  it("#given no agent dir, no file or malformed providers #when read #then returns no providers", () => {
    expect(customModelProviders(undefined)).toEqual([])
    const withoutFile = mkdtempSync(join(tmpdir(), "omo-custom-providers-missing-"))
    dirs.push(withoutFile)
    expect(customModelProviders(withoutFile)).toEqual([])
    expect(customModelProviders(agentDirWith(`{ "providers": [] }`))).toEqual([])
  })
})
