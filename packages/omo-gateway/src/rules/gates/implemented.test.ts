import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { GATE_IDS } from "../gates"

// R5: a rule can only name a gate the code enforces. Checked per file (not through the registry)
// so a missing gate module fails here with its id instead of breaking every import.
const FIXTURE_MAP = join(import.meta.dir, "../../../test/fixtures/slack-rules.map.json")

function referencedGates(): string[] {
  const map: unknown = JSON.parse(readFileSync(FIXTURE_MAP, "utf8"))
  const entries: unknown = typeof map === "object" && map !== null ? Reflect.get(map, "entries") : undefined
  if (!Array.isArray(entries)) throw new Error("fixture map has no entries")
  return [...new Set(entries.flatMap((entry: unknown) => {
    const gate: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "gate") : undefined
    return typeof gate === "string" ? [gate] : []
  }))]
}

async function implementation(id: string): Promise<string | null> {
  const file = join(import.meta.dir, `${id}.ts`)
  if (!existsSync(file)) return `${id}: no src/rules/gates/${id}.ts`
  const module: unknown = await import(file)
  const gate: unknown = typeof module === "object" && module !== null ? Reflect.get(module, "gate") : undefined
  if (typeof gate !== "object" || gate === null) return `${id}: module exports no gate`
  if (Reflect.get(gate, "id") !== id) return `${id}: exported gate has id ${String(Reflect.get(gate, "id"))}`
  if (typeof Reflect.get(gate, "run") !== "function") return `${id}: gate has no run function`
  return null
}

describe("every gate id is implemented (R5)", () => {
  it("#given the seed rules #when each referenced gate id is looked up #then it has a gate module", async () => {
    const referenced = referencedGates()
    expect(referenced.length).toBe(12)
    const missing = (await Promise.all(referenced.map(implementation))).filter((entry) => entry !== null)
    expect(missing).toEqual([])
  })

  it("#given the closed gate set #when each id is looked up #then every one has a gate module", async () => {
    const missing = (await Promise.all(GATE_IDS.map(implementation))).filter((entry) => entry !== null)
    expect(missing).toEqual([])
  })
})
