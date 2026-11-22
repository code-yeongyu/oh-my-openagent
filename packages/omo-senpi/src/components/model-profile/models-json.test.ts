/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readModelsJson } from "./models-json"

const dirs: string[] = []

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-models-json-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("readModelsJson", () => {
  it("#given an unchanged models.json #when read twice #then the second read returns the cached parse", () => {
    const dir = agentDir()
    writeFileSync(join(dir, "models.json"), `{ "providers": { "proxy": { "models": [{ "id": "a" }] } } }`)

    const first = readModelsJson(dir)

    expect(first).toEqual({ providers: { proxy: { models: [{ id: "a" }] } } })
    expect(readModelsJson(dir)).toBe(first)
  })

  it("#given a caller tries to write into the returned parse #when read again #then the cached value is unchanged", () => {
    const dir = agentDir()
    writeFileSync(join(dir, "models.json"), `{ "providers": { "proxy": { "models": [{ "id": "a" }] } } }`)
    const first = readModelsJson(dir) as { providers: { proxy: { models: { id: string }[] } } }

    expect(() => {
      first.providers.proxy.models.push({ id: "b" })
    }).toThrow()
    expect(() => {
      first.providers = { proxy: { models: [] } }
    }).toThrow()
    expect(readModelsJson(dir)).toEqual({ providers: { proxy: { models: [{ id: "a" }] } } })
  })

  it("#given models.json is edited or removed after a read #when read again #then the new content is returned", () => {
    const dir = agentDir()
    const path = join(dir, "models.json")
    writeFileSync(path, `{ "providers": {} }`)
    expect(readModelsJson(dir)).toEqual({ providers: {} })

    writeFileSync(path, `{ "providers": { "proxy": { "models": [{ "id": "claude-opus-5-5" }] } } }`)
    expect(readModelsJson(dir)).toEqual({ providers: { proxy: { models: [{ id: "claude-opus-5-5" }] } } })

    rmSync(path)
    expect(readModelsJson(dir)).toBeNull()
  })
})
