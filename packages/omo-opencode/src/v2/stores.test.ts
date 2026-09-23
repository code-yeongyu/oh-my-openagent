import { describe, expect, it } from "bun:test"
import { createSessionRegistry, createStatusCache, createTodoStore } from "./stores"
import type { V2Storage } from "./types"

function createMemoryStorage(): V2Storage & { size(): number } {
  const data = new Map<string, unknown>()
  const storage = {
    size: () => data.size,
    get: async (key: string) => data.get(key) as never,
    set: async (key: string, value: never) => {
      data.set(key, value)
    },
    remove: async (key: string) => {
      data.delete(key)
    },
    scan: async (options: { prefix: string; after?: string; limit?: number }) => {
      const keys = [...data.keys()].filter((key) => key.startsWith(options.prefix)).sort()
      const start = options.after ? keys.findIndex((key) => key > options.after) : 0
      const page = keys.slice(start === -1 ? keys.length : start, start + (options.limit ?? 100))
      return {
        entries: page.map((key) => ({ key, value: data.get(key) as never })),
        next: undefined,
      }
    },
  }
  return storage as unknown as V2Storage & { size(): number }
}

describe("#given session registry over memory storage", () => {
  describe("#when registering parent and child sessions", () => {
    it("#then childrenOf resolves the child and get returns records", async () => {
      // given
      const registry = createSessionRegistry(createMemoryStorage())

      // when
      await registry.register({ id: "parent", directory: "/proj", createdAt: 1 })
      await registry.register({ id: "child", parentID: "parent", directory: "/proj", createdAt: 2 })

      // then
      expect((await registry.get("parent"))?.directory).toBe("/proj")
      expect((await registry.childrenOf("parent")).map((record) => record.id)).toEqual(["child"])
      expect((await registry.list()).map((record) => record.id)).toEqual(["parent", "child"])
    })
  })

  describe("#when removing a session", () => {
    it("#then get returns undefined", async () => {
      // given
      const registry = createSessionRegistry(createMemoryStorage())
      await registry.register({ id: "gone", directory: "/proj", createdAt: 1 })

      // when
      await registry.remove("gone")

      // then
      expect(await registry.get("gone")).toBeUndefined()
    })
  })
})

describe("#given todo store over memory storage", () => {
  describe("#when setting and getting todos", () => {
    it("#then round-trips items and defaults to empty", async () => {
      // given
      const store = createTodoStore(createMemoryStorage())

      // when
      await store.set("ses-1", [{ content: "do it", status: "in_progress", priority: "high" }])

      // then
      expect(await store.get("ses-1")).toEqual([{ content: "do it", status: "in_progress", priority: "high" }])
      expect(await store.get("unknown")).toEqual([])
    })
  })
})

describe("#given status cache", () => {
  describe("#when no status recorded", () => {
    it("#then defaults to idle and snapshot matches V1 status shape", () => {
      // given
      const cache = createStatusCache()

      // when
      cache.set("busy-one", "busy")

      // then
      expect(cache.get("unknown")).toBe("idle")
      expect(cache.snapshot()).toEqual({ "busy-one": { type: "busy" } })
    })
  })
})
