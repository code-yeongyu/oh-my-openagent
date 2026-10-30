/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createJsonFileCacheStore } from "./json-file-cache-store"

type Snapshot = { models: Record<string, unknown>; generatedAt: string }

const snapshotA: Snapshot = { models: { "provider/model-a": { reasoning: true } }, generatedAt: "2026-10-12T00:00:00Z" }
const snapshotB: Snapshot = { models: { "provider/model-a": { reasoning: false } }, generatedAt: "2026-10-12T01:00:00Z" }

describe("json-file-cache-store writeIfChanged", () => {
  let cacheDir: string
  let store: ReturnType<typeof createJsonFileCacheStore<Snapshot>>

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "omo-jfcs-"))
    store = createJsonFileCacheStore<Snapshot>({
      getCacheDir: () => cacheDir,
      filename: "snapshot.json",
      logPrefix: "test-cache",
      cacheLabel: "Cache",
      describe: (value) => ({ generatedAt: value.generatedAt }),
      serialize: (value) => `${JSON.stringify(value, null, 2)}\n`,
    })
  })

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
  })

  test("first write creates the file and returns true", () => {
    const wrote = store.writeIfChanged(snapshotA)

    expect(wrote).toBe(true)
    expect(existsSync(join(cacheDir, "snapshot.json"))).toBe(true)
  })

  test("identical content skips the write and returns false", () => {
    store.writeIfChanged(snapshotA)
    const file = join(cacheDir, "snapshot.json")
    const contentAfterFirstWrite = readFileSync(file, "utf-8")

    const wrote = store.writeIfChanged(snapshotA)

    expect(wrote).toBe(false)
    expect(readFileSync(file, "utf-8")).toBe(contentAfterFirstWrite)
  })

  test("changed content rewrites the file and returns true", () => {
    store.writeIfChanged(snapshotA)

    const wrote = store.writeIfChanged(snapshotB)

    expect(wrote).toBe(true)
    expect(JSON.parse(readFileSync(join(cacheDir, "snapshot.json"), "utf-8"))).toEqual(snapshotB)
  })

  test("skipped write still updates the in-memory value so has() stays true", () => {
    store.writeIfChanged(snapshotA)
    store.resetMemory()

    const wrote = store.writeIfChanged(snapshotA)

    expect(wrote).toBe(false)
    expect(store.has()).toBe(true)
    expect(store.read()).toEqual(snapshotA)
  })

  test("plain write still always writes (unchanged behavior for other callers)", () => {
    store.write(snapshotA)
    const before = readFileSync(join(cacheDir, "snapshot.json"), "utf-8")
    store.write(snapshotA)

    expect(readFileSync(join(cacheDir, "snapshot.json"), "utf-8")).toBe(before)
  })
})
