import { describe, expect, it } from "bun:test"
import {
  type BatchClient,
  type BatchUpdateItem,
  chunkArray,
  executeBatchDelete,
  executeBatchUpdate,
  MAX_BATCH_SIZE,
} from "./batch-ops"

describe("chunkArray", () => {
  it("#given array smaller than max #when chunked #then returns single chunk", () => {
    const chunks = chunkArray([1, 2, 3], 10)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual([1, 2, 3])
  })

  it("#given array exactly at max #when chunked #then returns single chunk", () => {
    const chunks = chunkArray([1, 2, 3], 3)
    expect(chunks).toHaveLength(1)
  })

  it("#given array above max #when chunked #then splits correctly", () => {
    const chunks = chunkArray([1, 2, 3, 4, 5], 2)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toEqual([1, 2])
    expect(chunks[1]).toEqual([3, 4])
    expect(chunks[2]).toEqual([5])
  })

  it("#given empty array #when chunked #then returns empty array of chunks", () => {
    expect(chunkArray([], 10)).toEqual([])
  })

  it("#given default max #when chunked #then respects MAX_BATCH_SIZE", () => {
    expect(MAX_BATCH_SIZE).toBe(1000)
    const items = new Array(2500).fill(0)
    const chunks = chunkArray(items)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]?.length).toBe(1000)
    expect(chunks[1]?.length).toBe(1000)
    expect(chunks[2]?.length).toBe(500)
  })
})

describe("executeBatchUpdate", () => {
  it("#given empty items #when executed #then returns zero totals", async () => {
    const client: BatchClient = {
      batchUpdate: async () => ({ updated: 0, failed: 0 }),
      batchDelete: async () => ({ deleted: 0, failed: 0 }),
    }
    const result = await executeBatchUpdate(client, [])
    expect(result.total).toBe(0)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })

  it("#given successful chunks #when executed #then aggregates succeeded counts", async () => {
    let callCount = 0
    const client: BatchClient = {
      batchUpdate: async (items) => {
        callCount++
        return { updated: items.length, failed: 0 }
      },
      batchDelete: async () => ({ deleted: 0, failed: 0 }),
    }
    const items: BatchUpdateItem[] = new Array(2500).fill(0).map((_, i) => ({
      memory_id: `m-${i}`,
      text: "t",
    }))
    const result = await executeBatchUpdate(client, items)
    expect(callCount).toBe(3)
    expect(result.total).toBe(2500)
    expect(result.succeeded).toBe(2500)
    expect(result.failed).toBe(0)
  })

  it("#given throwing client #when executed #then records errors", async () => {
    const client: BatchClient = {
      batchUpdate: async () => {
        throw new Error("boom")
      },
      batchDelete: async () => ({ deleted: 0, failed: 0 }),
    }
    const items: BatchUpdateItem[] = [{ memory_id: "m-1" }]
    const result = await executeBatchUpdate(client, items)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toBe("boom")
  })
})

describe("executeBatchDelete", () => {
  it("#given empty ids #when executed #then returns zero totals", async () => {
    const client: BatchClient = {
      batchUpdate: async () => ({ updated: 0, failed: 0 }),
      batchDelete: async () => ({ deleted: 0, failed: 0 }),
    }
    const result = await executeBatchDelete(client, [])
    expect(result.total).toBe(0)
  })

  it("#given ids exceeding one batch #when executed #then chunks automatically", async () => {
    let callCount = 0
    const client: BatchClient = {
      batchUpdate: async () => ({ updated: 0, failed: 0 }),
      batchDelete: async (ids) => {
        callCount++
        return { deleted: ids.length, failed: 0 }
      },
    }
    const ids = new Array(1500).fill(0).map((_, i) => `id-${i}`)
    const result = await executeBatchDelete(client, ids)
    expect(callCount).toBe(2)
    expect(result.total).toBe(1500)
    expect(result.succeeded).toBe(1500)
  })

  it("#given throwing client #when executed #then records failed chunk", async () => {
    const client: BatchClient = {
      batchUpdate: async () => ({ updated: 0, failed: 0 }),
      batchDelete: async () => {
        throw new Error("delete failed")
      },
    }
    const result = await executeBatchDelete(client, ["a", "b"])
    expect(result.failed).toBe(2)
    expect(result.errors[0]?.error).toBe("delete failed")
  })
})
