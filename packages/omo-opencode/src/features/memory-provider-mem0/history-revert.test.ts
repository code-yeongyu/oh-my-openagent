import { describe, expect, it } from "bun:test"
import {
  buildRevertUpdate,
  diffHistory,
  findEntryAt,
  HistoryRevertError,
  parseHistory,
} from "./history-revert"
import type { Mem0HistoryEntry, Mem0HistoryRawEntry } from "./types"

const raw: Mem0HistoryRawEntry[] = [
  { new_value: "v1", event: "ADD", created_at: "2026-04-01T00:00:00Z" },
  {
    previous_value: "v1",
    new_value: "v2",
    event: "UPDATE",
    created_at: "2026-04-02T00:00:00Z",
  },
  {
    previous_value: "v2",
    new_value: "v3",
    event: "UPDATE",
    created_at: "2026-04-03T00:00:00Z",
  },
]

describe("parseHistory", () => {
  it("#given raw entries #when parsed #then normalizes with memory_id and sorted by created_at", () => {
    const parsed = parseHistory("mem-1", [...raw].reverse())
    expect(parsed).toHaveLength(3)
    expect(parsed[0]?.created_at).toBe("2026-04-01T00:00:00Z")
    expect(parsed[2]?.created_at).toBe("2026-04-03T00:00:00Z")
    expect(parsed.every((e) => e.memory_id === "mem-1")).toBe(true)
  })

  it("#given entries missing new_value or event #when parsed #then filters them out", () => {
    const parsed = parseHistory("mem-1", [
      { new_value: "v1", event: "ADD" },
      { event: "UPDATE", created_at: "2026-04-02T00:00:00Z" },
      { new_value: "v2", created_at: "2026-04-03T00:00:00Z" },
    ])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.new_value).toBe("v1")
  })
})

describe("findEntryAt", () => {
  const parsed = parseHistory("mem-1", raw)

  it("#given timestamp exactly at entry #when searched #then returns that entry", () => {
    const found = findEntryAt(parsed, "2026-04-02T00:00:00Z")
    expect(found?.new_value).toBe("v2")
  })

  it("#given timestamp between entries #when searched #then returns earlier entry", () => {
    const found = findEntryAt(parsed, "2026-04-02T12:00:00Z")
    expect(found?.new_value).toBe("v2")
  })

  it("#given timestamp before all entries #when searched #then returns undefined", () => {
    const found = findEntryAt(parsed, "2026-03-31T00:00:00Z")
    expect(found).toBeUndefined()
  })
})

describe("buildRevertUpdate", () => {
  it("#given UPDATE entry with previous_value #when built #then payload contains previous_value", () => {
    const entry: Mem0HistoryEntry = {
      memory_id: "mem-1",
      previous_value: "v1",
      new_value: "v2",
      action: "UPDATE",
      created_at: "2026-04-02T00:00:00Z",
    }
    const payload = buildRevertUpdate(entry)
    expect(payload.text).toBe("v1")
    expect(payload.metadata).toBeUndefined()
  })

  it("#given metadata override #when built #then payload includes metadata", () => {
    const entry: Mem0HistoryEntry = {
      memory_id: "mem-1",
      previous_value: "v1",
      new_value: "v2",
      action: "UPDATE",
      created_at: "2026-04-02T00:00:00Z",
    }
    const payload = buildRevertUpdate(entry, { source: "test" })
    expect(payload.metadata).toEqual({ source: "test" })
  })

  it("#given DELETE entry #when built #then throws HistoryRevertError", () => {
    const entry: Mem0HistoryEntry = {
      memory_id: "mem-1",
      new_value: "gone",
      action: "DELETE",
      created_at: "2026-04-05T00:00:00Z",
    }
    expect(() => buildRevertUpdate(entry)).toThrow(HistoryRevertError)
  })

  it("#given entry missing restorable value #when built #then throws", () => {
    const entry: Mem0HistoryEntry = {
      memory_id: "mem-1",
      new_value: "",
      action: "UPDATE",
      created_at: "2026-04-02T00:00:00Z",
    }
    expect(() => buildRevertUpdate(entry)).toThrow(HistoryRevertError)
  })
})

describe("diffHistory", () => {
  it("#given parsed history #when diffed #then returns from/to/action tuples", () => {
    const parsed = parseHistory("mem-1", raw)
    const diff = diffHistory(parsed)
    expect(diff).toHaveLength(3)
    expect(diff[0]).toEqual({
      from: undefined,
      to: "v1",
      action: "ADD",
      at: "2026-04-01T00:00:00Z",
    })
    expect(diff[1]?.from).toBe("v1")
    expect(diff[2]?.to).toBe("v3")
  })
})
