import { expect, it } from "bun:test"

import { compare } from "./lint-ratchet.ts"
import { compareValues, fileValues, FLAKE_MASKING, flakeMaskingFindings } from "./lint-ratchet-values.ts"

// #15114: a raised test timeout or retry keeps the finding count, so only the pinned values can see it.
const file = "packages/x/src/a.test.ts"
const changes = (before: string, after: string) =>
  compareValues(
    { [file]: fileValues(flakeMaskingFindings(file, before)) },
    { [file]: flakeMaskingFindings(file, after) },
  )
const ratchet = (before: string, after: string) => changes(before, after).raises

const withLimit = (limit: string) => `import { test } from "bun:test"\ntest("scan", () => {}, ${limit})\n`

it("refuses an existing test timeout raised from 60_000 to 216_000, naming the file, line and both values", () => {
  expect(ratchet(withLimit("60_000"), withLimit("216_000"))).toEqual([
    { file, kind: "timeout", line: 2, before: 60_000, after: 216_000 },
  ])
})

it("is a raise the count ratchet alone cannot see (control: the finding count stays at one)", () => {
  const counts = (source: string) => ({ [file]: { [FLAKE_MASKING]: flakeMaskingFindings(file, source).length } })
  expect(compare(counts(withLimit("60_000")), counts(withLimit("216_000")))).toEqual({ increases: [], decreases: [] })
})

it("accepts the same value lowered or unchanged as no raise", () => {
  expect(ratchet(withLimit("60_000"), withLimit("30_000"))).toEqual([])
  expect(changes(withLimit("60_000"), withLimit("60_000"))).toEqual({ raises: [], lowerings: [] })
})

it("asks for a lowered or removed value to be recorded, so the old pin cannot let it come back", () => {
  expect(changes(withLimit("60_000"), withLimit("30_000")).lowerings).toEqual([
    { file, kind: "timeout", line: 2, before: 60_000, after: 30_000 },
  ])
  expect(changes(withLimit("60_000"), 'import { test } from "bun:test"\ntest("scan", () => {})\n').lowerings).toEqual([
    { file, kind: "timeout", line: null, before: 60_000, after: 0 },
  ])
})

it("refuses a new timeout argument, like the count ratchet", () => {
  const added = `${withLimit("60_000")}test("other", () => {}, 5_000)\n`
  expect(ratchet(withLimit("60_000"), added)).toEqual([{ file, kind: "timeout", line: 3, before: 0, after: 5_000 }])
})

it("accepts cases moved within the file with their values unchanged", () => {
  const before = `import { test } from "bun:test"\ntest("a", () => {}, 60_000)\ntest("b", () => {}, 5_000)\n`
  const after = `import { test } from "bun:test"\ntest("b", () => {}, 5_000)\n\ntest("a", () => {}, 60_000)\n`
  expect(ratchet(before, after)).toEqual([])
})

it("compares a const the file declares by its value, and a raised retry option like a timeout", () => {
  const constant = (limit: string) => `const LIMIT = ${limit}\n${withLimit("LIMIT")}`
  expect(ratchet(constant("60000"), constant("216e3"))).toEqual([
    { file, kind: "timeout", line: 3, before: 60_000, after: 216_000 },
  ])
  const retry = (count: number) => `import { test } from "bun:test"\ntest("a", { retry: ${count} }, () => {})\n`
  expect(ratchet(retry(1), retry(3))).toEqual([{ file, kind: "retry", line: 2, before: 1, after: 3 }])
})

it("refuses a value it cannot resolve statically, so an indirection cannot hide a raise", () => {
  const imported = `import { LIMIT } from "./limits"\n${withLimit("LIMIT")}`
  expect(ratchet(withLimit("60_000"), imported)).toEqual([
    { file, kind: "unresolved", line: null, before: 0, after: 1 },
  ])
  const shadowed = `const LIMIT = 1\n{ const LIMIT = 216_000; test("scan", () => {}, LIMIT) }\nimport { test } from "bun:test"\n`
  expect(flakeMaskingFindings(file, shadowed)).toEqual([{ kind: "timeout", line: 2, value: null }])
  expect(ratchet(imported, imported)).toEqual([])
})
