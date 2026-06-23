import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Theory } from "./types"
import { createCacheStore } from "./cache-store"

const sampleTheory: Theory = {
  premises: [{ formula: "problem(current)", kind: "ordinary" }],
  strict_rules: [],
  defeasible_rules: [],
  preferences: [],
  classical_negation: true,
}

const sampleEntry = {
  theory: sampleTheory,
  createdAt: 123,
  modelId: "test-model",
  promptVersion: "v1",
  schemaVersion: 1,
}

const tempPaths: string[] = []

afterEach(() => {
  delete process.env.THEMIS_CACHE_FS

  for (const path of tempPaths.splice(0)) {
    chmodSync(path, 0o700)
    rmSync(path, { force: true, recursive: true })
  }
})

function createLogger() {
  return {
    debugCalls: [] as Array<Record<string, unknown> | undefined>,
    warnCalls: [] as Array<Record<string, unknown> | undefined>,
    debug(_msg: string, meta?: Record<string, unknown>) {
      this.debugCalls.push(meta)
    },
    warn(_msg: string, meta?: Record<string, unknown>) {
      this.warnCalls.push(meta)
    },
  }
}

function createTempPath(): string {
  const path = mkdtempSync(join(tmpdir(), "cache-store-"))
  tempPaths.push(path)

  return path
}

describe("createCacheStore", () => {
  describe("#given in-memory store", () => {
    it("#when set and get #then returns stored entry", () => {
      const logger = createLogger()
      const store = createCacheStore({ logger, persistence: "memory" })

      store.set("alpha", sampleEntry)

      expect(store.get("alpha")).toEqual(sampleEntry)
    })

    it("#when has after set #then returns true", () => {
      const logger = createLogger()
      const store = createCacheStore({ logger, persistence: "memory" })

      store.set("alpha", sampleEntry)

      expect(store.has("alpha")).toBe(true)
    })

    it("#when has before set #then returns false", () => {
      const logger = createLogger()
      const store = createCacheStore({ logger, persistence: "memory" })

      expect(store.has("alpha")).toBe(false)
    })

    it("#when delete after set #then has returns false", () => {
      const logger = createLogger()
      const store = createCacheStore({ logger, persistence: "memory" })

      store.set("alpha", sampleEntry)
      store.delete("alpha")

      expect(store.has("alpha")).toBe(false)
    })
  })

  describe("#given FS store (THEMIS_CACHE_FS=1)", () => {
    it("#when set and new instance get #then returns persisted entry", () => {
      process.env.THEMIS_CACHE_FS = "1"

      const fsBasePath = createTempPath()
      const logger = createLogger()
      const firstStore = createCacheStore({ logger, fsBasePath })

      firstStore.set("alpha", sampleEntry)

      const secondStore = createCacheStore({ logger: createLogger(), fsBasePath })

      expect(secondStore.get("alpha")).toEqual(sampleEntry)
    })

    it("#when FS write fails #then falls back to in-memory with warn log", () => {
      process.env.THEMIS_CACHE_FS = "1"

      const fsBasePath = createTempPath()
      chmodSync(fsBasePath, 0o500)
      const logger = createLogger()
      const store = createCacheStore({ logger, fsBasePath })

      store.set("alpha", sampleEntry)

      expect(store.get("alpha")).toEqual(sampleEntry)
      expect(logger.warnCalls).toHaveLength(1)
      expect(logger.warnCalls[0]).toEqual(
        expect.objectContaining({ key: "alpha", err: expect.anything() }),
      )
    })
  })
})
