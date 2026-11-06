import { describe, expect, test } from "bun:test"

import { splitItem } from "../item/frontmatter"
import { planAdoption } from "./adopt"
import { firstMissingFact } from "./read-back"
import { t2Block, soleRegisters } from "./test-support"

const SIDE = "n.sync-conflict-20261015-mac.md"
const NO_REGISTERS = new Map<string, string[]>()
const HEADER =
  "<!-- memory-sync 2026-10-15: the other machine had different frontmatter for n.md; kept here so no fact is lost:"
const live = (currentText: string | null) => ({ currentText, lastMaterialised: null, tombstoned: false, registers: soleRegisters(currentText) })
const bodyOf = (plan: ReturnType<typeof planAdoption>, base: string): string =>
  splitItem(plan.action === "capture" ? plan.workingText : base).body

describe("review r4 HIGH-1: text inside a T2 block after its closing fence", () => {
  const glued = `a\n${HEADER}\n---\nk: v\n---\nSECRET FACT\n-->\nb\n`
  const midLine = `a\n${HEADER}\n---\nk: v\n---\nFACT -->\nmore\n-->\nb\n`

  test("a side file with text after the fence keeps that text or stays on disk", () => {
    for (const side of [glued, midLine]) {
      const plan = planAdoption([{ path: SIDE, text: side }], live("base\n"))
      const kept = plan.retainedSources.some((entry) => entry.path === SIDE)
      const body = bodyOf(plan, "base\n")
      const facts = side === glued ? ["SECRET FACT"] : ["FACT -->", "more"]
      expect(kept || facts.every((fact) => body.split("\n").includes(fact)), JSON.stringify(body)).toBe(true)
    }
  })

  test("a main file never loses the text inside a malformed block", () => {
    for (const [main, facts] of [[glued, ["SECRET FACT"]], [midLine, ["FACT -->", "more"]]] as const) {
      const lines = bodyOf(planAdoption([{ path: "n.md", text: main }], live(null)), "").split("\n")
      for (const fact of facts) expect(lines, JSON.stringify(lines)).toContain(fact)
    }
  })
})

describe("the read-back is structure-free: every raw source line, as a multiset", () => {
  test("a dropped plain line keeps the source, even one that looks like block text", () => {
    expect(firstMissingFact("x\n", "x\ninside a block\n", NO_REGISTERS)).toBe('missing line "inside a block"')
  })

  test("a duplicated line merged once keeps the source", () => {
    expect(firstMissingFact("x\nd\n", "x\nd\nd\n", NO_REGISTERS)).toBe('missing line "d" (2 in the source, 1 merged)')
  })
})

describe("the enumerated metadata lines adoption may drop", () => {
  const block = t2Block("2026-10-15", "n.md", '---\nk: "v"\n---\n')
  const withKey = "---\nk: v\n---\nx\n"

  test("a T2 header line carries no fact", () => {
    expect(firstMissingFact(withKey, `x\n${block}`, NO_REGISTERS)).toBeNull()
  })

  test('the hub\'s fused closing line "----->" may drop once per T2 header, never more', () => {
    const fused = t2Block("2026-10-15", "n.md", '---\nk: "v"\n---')
    expect(fused).toContain("\n----->\n")
    expect(firstMissingFact(withKey, `x\n${fused}`, NO_REGISTERS)).toBeNull()
    expect(firstMissingFact("x\n", "x\n----->\n", NO_REGISTERS)).toBe('missing line "----->" (1 dropped, 0 allowed as metadata)')
  })

  test('"-->" may drop once per T2 header, never more', () => {
    expect(firstMissingFact(withKey, `x\n${block}`, NO_REGISTERS)).toBeNull()
    expect(firstMissingFact("x\n", "x\n-->\n", NO_REGISTERS)).toBe('missing line "-->" (1 dropped, 0 allowed as metadata)')
  })

  test("a blank line may drop once per T2 header (the hub's separator), never more", () => {
    expect(firstMissingFact(withKey, `x\n\n${block.slice(1)}`, NO_REGISTERS)).toBeNull()
    expect(firstMissingFact("x\n", "x\n\n", NO_REGISTERS)).toBe('missing line "" (1 dropped, 0 allowed as metadata)')
  })

  test('"---" may drop as the file header\'s two fences plus two per T2 header, never more', () => {
    expect(firstMissingFact("x\n", "---\nk: v\n---\nx\n", NO_REGISTERS)).toBe('missing line "k: v"')
    expect(firstMissingFact(withKey, "---\nk: v\n---\nx\n", NO_REGISTERS)).toBeNull()
    expect(firstMissingFact("x\n", "---\nk: v\n---\nx\n---\n", NO_REGISTERS)).toBe('missing line "---" (3 dropped, 2 allowed as metadata)')
  })

  test("a key line may drop only when the result represents that key's value", () => {
    expect(firstMissingFact("---\ntags:\n  - a\n  - b\n---\nx\n", "---\ntags: [a, b]\n---\nx\n", NO_REGISTERS)).toBeNull()
    expect(firstMissingFact("---\nk: other\n---\nx\n", `x\n${block}`, NO_REGISTERS)).toBe('missing line "k: \\"v\\""')
  })

  test("a multi-line value is never vouched for line by line", () => {
    expect(firstMissingFact("---\ntags: [a]\n---\nx\n", "---\ntags:\n  - a\n---\nx\n", NO_REGISTERS)).toBe('missing line "tags:"')
  })
})

describe("#10321: a joined register counts for nothing only in the result's own header", () => {
  const registers = new Map([["k", ["a", "b"]]])

  test("a body line under a joined key is text", () => {
    expect(firstMissingFact('---\nk: "a / b"\n---\nk: zzz\n', "k: zzz\n", registers)).toBeNull()
  })

  test("a body line equal to the joined header line is text; the header line itself still vouches for nothing", () => {
    expect(firstMissingFact('---\nk: "a / b"\n---\nk: "a / b"\n', 'k: "a / b"\n', registers)).toBeNull()
    expect(firstMissingFact('---\nk: "a / b"\n---\nx\n', 'x\nk: "a / b"\n', registers)).toBe('missing line "k: \\"a / b\\""')
  })

  test("a leading BOM on the result does not move the header range", () => {
    expect(firstMissingFact('\uFEFF---\nk: "a / b"\n---\nx\n', 'x\nk: "a / b"\n', registers)).toBe('missing line "k: \\"a / b\\""')
  })
})
