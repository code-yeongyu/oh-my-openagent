import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { curatedRows, engineMethodClasses, pairTestProblems, renderTable, TABLE_PATH } from "./rpc-relay-parity.ts"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const rowsFile = (content: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), "rpc-parity-rows-"))
  dirs.push(dir)
  const path = join(dir, "rows.json")
  writeFileSync(path, JSON.stringify(content))
  return path
}

describe("engine RPC local-versus-relay parity table (#13478)", () => {
  test("the committed table has one row per method in the pinned engine's method table", async () => {
    expect(readFileSync(TABLE_PATH, "utf8")).toBe(renderTable(await engineMethodClasses(), curatedRows()))
  })

  test("every curated row names a method the engine still has", async () => {
    const { classes } = await engineMethodClasses()
    expect(Object.keys(curatedRows()).filter((name) => !(name in classes))).toEqual([])
  })

  test("every curated pair test is a file in this repository that names its method", () => {
    expect(pairTestProblems(curatedRows())).toEqual([])
  })

  test("a pair test naming a missing file is reported", () => {
    expect(pairTestProblems({ prompt: { test: "no/such/pair.test.ts (fakes)" } })).toEqual([
      "prompt: pair test no/such/pair.test.ts does not exist",
    ])
  })

  test("a rows file with a misspelled key is refused", () => {
    expect(() => curatedRows(rowsFile({ prompt: { relaay: "differs" } }))).toThrow('unknown key "relaay"')
  })

  test("a rows file with a non-string verdict is refused", () => {
    expect(() => curatedRows(rowsFile({ prompt: { relay: 1 } }))).toThrow("prompt.relay is not a string")
  })
})
