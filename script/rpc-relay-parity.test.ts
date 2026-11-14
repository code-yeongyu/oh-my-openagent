import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { curatedRows, engineMethodClasses, renderTable, TABLE_PATH } from "./rpc-relay-parity.ts"

describe("engine RPC local-versus-relay parity table (#13478)", () => {
  test("the committed table has one row per method in the pinned engine's method table", async () => {
    expect(readFileSync(TABLE_PATH, "utf8")).toBe(renderTable(await engineMethodClasses(), curatedRows()))
  })

  test("every curated row names a method the engine still has", async () => {
    const { classes } = await engineMethodClasses()
    expect(Object.keys(curatedRows()).filter((name) => !(name in classes))).toEqual([])
  })
})
