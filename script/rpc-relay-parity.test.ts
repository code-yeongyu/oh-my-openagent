import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  checkProblems,
  curatedRows,
  engineMethodClasses,
  namesRecordType,
  pairTestProblems,
  renderTable,
  TABLE_PATH,
} from "./rpc-relay-parity.ts"

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

  test("a pair test names its method only where the method is a record type", () => {
    expect(namesRecordType('entry.rpc?.["type"] === "prompt"', "prompt")).toBe(true)
    expect(namesRecordType('send({ type: "prompt", message: "hi" })', "prompt")).toBe(true)
    expect(namesRecordType("expect(record.type).toBe('prompt')", "prompt")).toBe(true)
    expect(namesRecordType('// covers "prompt"\ntest("prompt answers", () => {})', "prompt")).toBe(false)
    expect(namesRecordType('{ type: "prompt_template" }', "prompt")).toBe(false)
  })

  test("a record-type shape inside a comment, a string or a $type property does not count as a pair test", () => {
    expect(namesRecordType('// sends { type: "prompt" }\n', "prompt")).toBe(false)
    expect(namesRecordType('/* expects record.type === "prompt" */', "prompt")).toBe(false)
    expect(namesRecordType(`test('type: "prompt" relays', () => {})`, "prompt")).toBe(false)
    expect(namesRecordType('const title = `type: "prompt"`', "prompt")).toBe(false)
    expect(namesRecordType('if (frame.$type === "prompt") relay()', "prompt")).toBe(false)
    expect(namesRecordType('// comment first\nsend({ type: "prompt" })', "prompt")).toBe(true)
  })

  test("--check reports a broken pair-test row even when the committed table is current", async () => {
    const rows = { prompt: { test: "no/such/pair.test.ts (fakes)" } }
    const rendered = renderTable(await engineMethodClasses(), rows)
    expect(checkProblems(rendered, rendered, rows)).toEqual(["prompt: pair test no/such/pair.test.ts does not exist"])
  })

  test("--check reports a stale committed table", async () => {
    const rendered = renderTable(await engineMethodClasses(), {})
    expect(checkProblems(`${rendered}stale`, rendered, {})).toEqual([
      `${TABLE_PATH} is stale; run: bun script/rpc-relay-parity.ts`,
    ])
  })

  test("regex literals, ternaries, type declarations and template expressions are read as code (#13826 review L1-L3)", () => {
    expect(namesRecordType(`/'/.test(x)\ntest('type: "prompt" relays', () => {})`, "prompt")).toBe(false)
    expect(namesRecordType(`const q = /["']/g\nsend({ type: "prompt" })`, "prompt")).toBe(true)
    expect(namesRecordType('const u = /https?:\\/\\//\nsend({ type: "prompt" })', "prompt")).toBe(true)
    expect(namesRecordType('const k = flag ? "type" : "prompt"', "prompt")).toBe(false)
    expect(namesRecordType('expect(s).toMatch(/type: "prompt"/)', "prompt")).toBe(false)
    expect(namesRecordType('type Frame = { type: "prompt" }', "prompt")).toBe(false)
    expect(namesRecordType('const t = `${send({ type: "prompt" })}`', "prompt")).toBe(true)
    expect(namesRecordType('if (frame?.type === "prompt") relay()', "prompt")).toBe(true)
  })

  test("a rows file with a misspelled key is refused", () => {
    expect(() => curatedRows(rowsFile({ prompt: { relaay: "differs" } }))).toThrow('unknown key "relaay"')
  })

  test("a rows file with a non-string verdict is refused", () => {
    expect(() => curatedRows(rowsFile({ prompt: { relay: 1 } }))).toThrow("prompt.relay is not a string")
  })
})
