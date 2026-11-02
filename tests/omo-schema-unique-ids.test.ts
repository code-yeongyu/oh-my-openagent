import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

const SCHEMA_PATH = join(import.meta.dir, "..", "assets", "omo.schema.json")

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function collectIds(node: unknown, path: string, found: Map<string, string[]>): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectIds(child, `${path}/${index}`, found))
    return
  }
  if (!isRecord(node)) return
  if (typeof node.$id === "string") found.set(node.$id, [...(found.get(node.$id) ?? []), path || "/"])
  for (const [key, child] of Object.entries(node)) collectIds(child, `${path}/${key}`, found)
}

function child(node: unknown, key: string): unknown {
  if (!isRecord(node)) throw new Error(`expected an object before ${key}`)
  return node[key]
}

describe("omo.schema.json identifiers (#6444)", () => {
  test("#given the committed omo schema #when every $id is collected #then no $id names more than one schema", () => {
    // given
    const schema: unknown = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"))
    const found = new Map<string, string[]>()

    // when
    collectIds(schema, "", found)

    // then
    const duplicated = [...found].filter(([, paths]) => paths.length > 1)
    expect(duplicated).toEqual([])
  })

  test("#given the top-level and per-profile [opencode] blocks #when read #then both point at the one embedded definition with a local reference", () => {
    // given
    const schema: unknown = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"))
    const properties = child(schema, "properties")
    const profile = child(child(properties, "profiles"), "additionalProperties")

    // when
    const topLevel = child(properties, "[opencode]")
    const nested = child(child(profile, "properties"), "[opencode]")
    const embedded = child(child(schema, "definitions"), "opencode")

    // then
    expect(topLevel).toEqual({ $ref: "#/definitions/opencode" })
    expect(nested).toEqual({ $ref: "#/definitions/opencode" })
    expect(isRecord(embedded) && isRecord(embedded.properties)).toBe(true)
    expect(isRecord(embedded) ? embedded.$id : "missing").toBeUndefined()
  })
})
