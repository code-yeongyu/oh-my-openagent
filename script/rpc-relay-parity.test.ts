import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  checkProblems,
  curatedRows,
  engineMethodClasses,
  pairTestProblems,
  renderTable,
  TABLE_PATH,
} from "./rpc-relay-parity.ts"
import { namesRecordType } from "./rpc-relay-parity-matcher.ts"

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

  test("a case of a switch on a type member counts as a pair test (#13826 review L4)", () => {
    expect(namesRecordType('switch (frame.type) { case "prompt": relay() }', "prompt")).toBe(true)
  })

  test("'as const', parenthesized and 'as string' forms of the literal count as a pair test (#13826 review L5)", () => {
    expect(namesRecordType('send({ type: "prompt" as const })', "prompt")).toBe(true)
    expect(namesRecordType('send({ type: ("prompt") })', "prompt")).toBe(true)
    expect(namesRecordType('if (frame.type === ("prompt" as string)) relay()', "prompt")).toBe(true)
  })

  test("a computed key { [type]: m } does not count as a pair test (#13826 review L6)", () => {
    expect(namesRecordType('const record = { [type]: "prompt" }', "prompt")).toBe(false)
  })

  test("toBe on a subject that is not expect(...) does not count as a pair test (#13826 review L6)", () => {
    expect(namesRecordType('check(frame.type).toBe("prompt")', "prompt")).toBe(false)
  })

  test("'satisfies', a non-null type member and an asserted type member count as a pair test (#13935 review L1)", () => {
    expect(namesRecordType('send({ type: "prompt" satisfies string })', "prompt")).toBe(true)
    expect(namesRecordType('if (frame.type! === "prompt") relay()', "prompt")).toBe(true)
    expect(namesRecordType('if ((frame.type as string) === "prompt") relay()', "prompt")).toBe(true)
  })

  test("toStrictEqual, a mapped type list, a plain template literal and assert.equal count as a pair test (#13935 review L2)", () => {
    expect(namesRecordType('expect(frame.type).toStrictEqual("prompt")', "prompt")).toBe(true)
    expect(namesRecordType('expect(sent.map((e) => e.type)).toEqual(["prompt"])', "prompt")).toBe(true)
    expect(namesRecordType("send({ type: `prompt` })", "prompt")).toBe(true)
    expect(namesRecordType('assert.equal(frame.type, "prompt")', "prompt")).toBe(true)
  })

  test("near misses of the review L2 forms do not count as a pair test (#13935 review L2)", () => {
    expect(namesRecordType("send({ type: `${kind}` })", "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.map((e) => e.kind)).toEqual(["prompt"])', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.map((e) => e.type)).toEqual(["other"])', "prompt")).toBe(false)
    expect(namesRecordType('check.equal(frame.type, "prompt")', "prompt")).toBe(false)
    expect(namesRecordType('assert.equal(frame.kind, "prompt")', "prompt")).toBe(false)
  })

  test("every counted form has its own case: argument order, block body, strictEqual, == and more (#13935 review 2 L1)", () => {
    expect(namesRecordType('assert.equal("prompt", frame.type)', "prompt")).toBe(true)
    expect(namesRecordType('assert.strictEqual(frame.type, "prompt")', "prompt")).toBe(true)
    expect(namesRecordType('expect(sent.map((e) => { return e.type })).toEqual(["prompt"])', "prompt")).toBe(true)
    expect(namesRecordType('expect(sent.map(function (e) { return e.type })).toEqual(["prompt"])', "prompt")).toBe(true)
    expect(namesRecordType('expect(sent.map((e) => e?.type)).toStrictEqual(["prompt"])', "prompt")).toBe(true)
    expect(namesRecordType('if (frame.type == "prompt") relay()', "prompt")).toBe(true)
    expect(namesRecordType('expect(frame.type).toEqual("prompt")', "prompt")).toBe(true)
    expect(namesRecordType('send({ "type": "prompt" })', "prompt")).toBe(true)
    expect(namesRecordType('const record = { ["type"]: "prompt" }', "prompt")).toBe(true)
    expect(namesRecordType('send({ type: <string>"prompt" })', "prompt")).toBe(true)
    expect(namesRecordType('switch (frame.type as string) { case "prompt": relay() }', "prompt")).toBe(true)
  })

  test("a negative comparison excludes the method, so !== and != do not count (#13935 review 2 L2)", () => {
    expect(namesRecordType('const rest = frames.filter((f) => f.type !== "prompt")', "prompt")).toBe(false)
    expect(namesRecordType('if (frame.type !== "prompt") skip()', "prompt")).toBe(false)
    expect(namesRecordType('if (frame.type != "prompt") skip()', "prompt")).toBe(false)
    expect(namesRecordType('expect(frame.type).not.toBe("prompt")', "prompt")).toBe(false)
  })

  test("a mapped list counts only for its own parameter, a plain .map and toEqual (#13935 review 2 L3)", () => {
    expect(namesRecordType('expect(sent.map((e) => other.type)).toEqual(["prompt"])', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent[map]((e) => e.type)).toEqual(["prompt"])', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.map((e) => e.type)).toBe(["prompt"])', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.map((e) => { log(e); return e.type })).toEqual(["prompt"])', "prompt")).toBe(
      false,
    )
  })

  test("a source that does not parse does not count, even when it holds a counted shape", () => {
    expect(namesRecordType('send({ type: "prompt" ', "prompt")).toBe(false)
    // A top-level return is a parse error, yet the recovered AST still holds the send call.
    expect(namesRecordType('send({ type: "prompt" })\nreturn', "prompt")).toBe(false)
  })

  test("a mapped list may read its parameter through an assertion: (e as Frame).type (#13935 review 3 L1)", () => {
    expect(namesRecordType('expect(sent.map((e) => (e as Frame).type)).toEqual(["prompt"])', "prompt")).toBe(true)
  })

  test("a comparison under ! or inside a subject asserted false does not count (#13935 review 3 L2)", () => {
    expect(namesRecordType('const rest = frames.filter((f) => !(f.type === "prompt"))', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.some((e) => e.type === "prompt")).toBe(false)', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.some((e) => e.type === "prompt")).toStrictEqual(false)', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.some((e) => e.type === "prompt")).toBeFalsy()', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.some((e) => e.type === "prompt")).toBeFalse()', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.some((e) => e.type === "prompt")).not.toBe(true)', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.some((e) => e.type === "prompt")).not.toBeTrue()', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.some((e) => e.type === "prompt")).not.toBeTruthy()', "prompt")).toBe(false)
  })

  test("a comparison asserted true still counts (#13935 review 3 L2)", () => {
    expect(namesRecordType('expect(sent.some((e) => e.type === "prompt")).toBe(true)', "prompt")).toBe(true)
    expect(namesRecordType('expect(sent.some((e) => e.type === "prompt")).not.toBe(false)', "prompt")).toBe(true)
    expect(namesRecordType('expect(sent.some((e) => e.type === "prompt")).toBeTruthy()', "prompt")).toBe(true)
  })

  test("a destructured map callback and an optional .map call count as a mapped list (#13935 review 3 L3)", () => {
    expect(namesRecordType('expect(sent.map(({ type }) => type)).toEqual(["prompt"])', "prompt")).toBe(true)
    expect(namesRecordType('expect(sent.map(({ type: t }) => t)).toEqual(["prompt"])', "prompt")).toBe(true)
    expect(namesRecordType('expect(sent.map(({ ["type"]: t }) => t)).toEqual(["prompt"])', "prompt")).toBe(true)
    expect(namesRecordType('expect(sent?.map((e) => e.type)).toEqual(["prompt"])', "prompt")).toBe(true)
    expect(namesRecordType('expect(sent.map(({ kind }) => kind)).toEqual(["prompt"])', "prompt")).toBe(false)
    expect(namesRecordType('expect(sent.map(({ type: t }) => other)).toEqual(["prompt"])', "prompt")).toBe(false)
  })

  test("a rows file with a misspelled key is refused", () => {
    expect(() => curatedRows(rowsFile({ prompt: { relaay: "differs" } }))).toThrow('unknown key "relaay"')
  })

  test("a rows file with a non-string verdict is refused", () => {
    expect(() => curatedRows(rowsFile({ prompt: { relay: 1 } }))).toThrow("prompt.relay is not a string")
  })
})
