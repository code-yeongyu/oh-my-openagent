import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ROUTE_PARITY } from "../packages/omo-senpi/src/components/thread/testing/route-parity.pair.ts"
import {
  curatedRows,
  engineMethodClasses,
  pairDeclarations,
  pairTestProblems,
  pairTestsByMethod,
  RPC_METHODS_PATH,
  renderRpcMethods,
  renderTable,
  staleProblems,
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
    const pairs = pairTestsByMethod(await pairDeclarations())
    expect(readFileSync(TABLE_PATH, "utf8")).toBe(renderTable(await engineMethodClasses(), curatedRows(), pairs))
  })

  test("the committed method list that pair tests' covers are typed against is the engine's (#13961)", async () => {
    expect(readFileSync(RPC_METHODS_PATH, "utf8")).toBe(renderRpcMethods(await engineMethodClasses()))
  })

  test("every curated row names a method the engine still has", async () => {
    const { classes } = await engineMethodClasses()
    expect(Object.keys(curatedRows()).filter((name) => !(name in classes))).toEqual([])
  })

  test("the table reads pair tests only from *.pair.ts declarations, and each names an existing test and engine methods (#13961)", async () => {
    const declarations = await pairDeclarations()
    expect(declarations).toContainEqual({ file: expect.stringMatching(/route-parity\.pair\.ts$/), ...ROUTE_PARITY })
    expect(pairTestProblems(declarations, (await engineMethodClasses()).classes)).toEqual([])
    expect(pairTestsByMethod(declarations)["admit_external_message"]).toContain(ROUTE_PARITY.test)
  })

  test("a declaration naming a missing test file or a method the engine lacks is reported (#13961)", async () => {
    const { classes } = await engineMethodClasses()
    const broken = [{ file: "x.pair.ts", test: "no/such/pair.test.ts", covers: ["prompt", "no_such_method"] }]
    expect(pairTestProblems(broken, classes)).toEqual([
      "x.pair.ts: pair test no/such/pair.test.ts does not exist",
      "x.pair.ts: no_such_method is not a method of the engine's table",
    ])
  })

  test("two declarations of one method are both shown in its pair-test column (#13961)", () => {
    const both = [
      { file: "a.pair.ts", test: "a.test.ts", covers: ["prompt"] },
      { file: "b.pair.ts", test: "b.test.ts", covers: ["prompt", "steer"] },
    ]
    expect(pairTestsByMethod(both)).toEqual({ prompt: "a.test.ts, b.test.ts", steer: "b.test.ts" })
  })

  test("--check reports a stale committed table and a stale method list", async () => {
    const methods = await engineMethodClasses()
    const rendered = { table: renderTable(methods, {}, {}), methods: renderRpcMethods(methods) }
    expect(staleProblems(rendered, rendered)).toEqual([])
    expect(staleProblems({ table: `${rendered.table}stale`, methods: `${rendered.methods}stale` }, rendered)).toEqual([
      `${TABLE_PATH} is stale; run: bun script/rpc-relay-parity.ts`,
      `${RPC_METHODS_PATH} is stale; run: bun script/rpc-relay-parity.ts`,
    ])
  })

  test("a rows file with a misspelled key is refused", () => {
    expect(() => curatedRows(rowsFile({ prompt: { relaay: "differs" } }))).toThrow('unknown key "relaay"')
  })

  test("a rows file that still names a pair test is refused: pair tests are declared in *.pair.ts (#13961)", () => {
    expect(() => curatedRows(rowsFile({ prompt: { test: "x.test.ts" } }))).toThrow('unknown key "test"')
  })

  test("a rows file with a non-string verdict is refused", () => {
    expect(() => curatedRows(rowsFile({ prompt: { relay: 1 } }))).toThrow("prompt.relay is not a string")
  })
})
