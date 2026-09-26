import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

const ASSETS = join(import.meta.dir, "..", "assets")

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Every `required` name whose property schema declares a default, as `<path>:<name>`. */
function requiredWithDefault(node: unknown, path: string, found: string[]): string[] {
  if (Array.isArray(node)) {
    node.forEach((child, index) => requiredWithDefault(child, `${path}/${index}`, found))
    return found
  }
  if (!isRecord(node)) return found
  const properties = node.properties
  if (Array.isArray(node.required) && isRecord(properties)) {
    for (const name of node.required) {
      const property = typeof name === "string" ? properties[name] : undefined
      if (isRecord(property) && "default" in property) found.push(`${path || "/"}:${String(name)}`)
    }
  }
  for (const [key, child] of Object.entries(node)) requiredWithDefault(child, `${path}/${key}`, found)
  return found
}

describe("committed config schemas leave defaulted fields optional (#6445)", () => {
  for (const file of ["omo.schema.json", "oh-my-opencode.schema.json"]) {
    test(`#given assets/${file} #when every required name is checked #then none of them has a schema default`, () => {
      // given
      const schema: unknown = JSON.parse(readFileSync(join(ASSETS, file), "utf-8"))

      // when
      const offenders = requiredWithDefault(schema, "", [])

      // then
      expect(offenders).toEqual([])
    })
  }
})
