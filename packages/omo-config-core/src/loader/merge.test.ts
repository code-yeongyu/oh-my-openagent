import { describe, expect, test } from "bun:test"
import { parseJsoncSafe } from "@oh-my-opencode/utils"
import { mergeOmoConfigRecords } from "./merge"

function toRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }

  const record: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry
  }
  return record
}

describe("mergeOmoConfigRecords", () => {
  test("#given nested unsafe keys under newly assigned objects #when merging #then unsafe keys are removed and prototypes stay clean", () => {
    // given
    const parsed = parseJsoncSafe<Record<string, unknown>>(`{
      "categories": {
        "quick": {
          "tools": {
            "bash": true,
            "__proto__": { "polluted": true },
            "constructor": { "polluted": true },
            "prototype": { "polluted": true }
          }
        }
      }
    }`)
    if (parsed.data === null) throw new Error("malicious fixture must parse")

    // when
    const merged = mergeOmoConfigRecords({}, parsed.data)
    const categories = toRecord(merged.categories, "categories")
    const quick = toRecord(categories.quick, "quick")
    const tools = toRecord(quick.tools, "tools")

    // then
    expect(tools.bash).toBe(true)
    expect(Object.hasOwn(tools, "__proto__")).toBe(false)
    expect(Object.hasOwn(tools, "constructor")).toBe(false)
    expect(Object.hasOwn(tools, "prototype")).toBe(false)
    expect("polluted" in Object.prototype).toBe(false)
  })
})
