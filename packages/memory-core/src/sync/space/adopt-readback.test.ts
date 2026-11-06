import { describe, expect, test } from "bun:test"

import { splitItem } from "../item/frontmatter"
import { activeRegisters } from "../item/index"
import { renderDocContent } from "../item/render"
import { captureInto, mulberry32, newDoc, pick } from "../item/test-support"
import { planAdoption } from "./adopt"
import { confirmRemovals, type RemovalDecision } from "./confirm-removals"
import { stripT2Blocks } from "./hub-trace"

import { applyPlan, holdsValue, renderedFacts, soleRegisters, t2Block } from "./test-support"

// 2,000 generated cases are CPU-bound; under host load they exceed bun's 5 s default.
const PROPERTY_TIMEOUT_MS = 60_000

// The oracle never parses a source with the code under test: every source is built from
// facts the test already knows, so a strip bug cannot hide in both sides of the check.

const SIDE = "n.sync-conflict-20261015-mac.md"

function linesOf(text: string): readonly string[] {
  if (text === "") return []
  const lines = text.split("\n")
  if (text.endsWith("\n")) lines.pop()
  return lines
}

function countOf(lines: readonly string[], line: string): number {
  return lines.filter((candidate) => candidate === line).length
}


describe("H1: a mid-body T2 block never glues its neighbours", () => {
  const block = t2Block("2026-10-15", "n.md", '---\nk: "v"\n---\n')

  test("a block right after a text line keeps that line's newline", () => {
    expect(stripT2Blocks(`line1\n${block.slice(1)}line2\n`).body).toBe("line1\nline2\n")
  })

  test("the hub's separated form still strips its blank separator", () => {
    expect(stripT2Blocks(`x\n${block}y\n`).body).toBe("x\ny\n")
    expect(stripT2Blocks(`x\n${block}`).body).toBe("x\n")
  })

  test("a side file with a glued block is adopted with both lines intact", () => {
    const side = `line1\n${block.slice(1)}line2\n`
    const plan = planAdoption([{ path: SIDE, text: side }], { currentText: "base\n", lastMaterialised: null, tombstoned: false, registers: soleRegisters("base\n") })
    const body = linesOf(splitItem(plan.rendered).body)
    expect(body).toContain("line1")
    expect(body).toContain("line2")
    expect(body.some((line) => line.includes("line1line2"))).toBe(false)
  })

  test("a main file with a glued block keeps both lines", () => {
    const main = `line1\n${block.slice(1)}line2\n`
    const plan = planAdoption([{ path: "n.md", text: main }], { currentText: null, lastMaterialised: null, tombstoned: false, registers: soleRegisters(null) })
    expect(linesOf(splitItem(plan.rendered).body)).toEqual(["line1", "line2"])
  })
})

describe("M1: the read-back counts lines", () => {
  test("a merge that collapses a duplicated line keeps the source", () => {
    const dedupe = (base: string, incoming: string): string => [...new Set(linesOf(base + incoming))].map((l) => `${l}\n`).join("")
    const plan = planAdoption([{ path: SIDE, text: "x\nd\nd\n" }], { currentText: "x\n", lastMaterialised: null, tombstoned: false, registers: soleRegisters("x\n") }, dedupe)
    expect(plan.removalCandidates).toEqual([])
    expect(plan.retainedSources.map((entry) => entry.path)).toEqual([SIDE])
  })
})

describe("L1: CRLF sources", () => {
  test("an LF main and a CRLF side do not duplicate shared lines", () => {
    const plan = planAdoption(
      [{ path: "n.md", text: "x\ny\n" }, { path: SIDE, text: "x\r\ny\r\nz\r\n" }],
      { currentText: "x\ny\n", lastMaterialised: null, tombstoned: false, registers: soleRegisters("x\ny\n") },
    )
    const out = plan.rendered
    expect(out.includes("\r")).toBe(false)
    expect(linesOf(splitItem(out).body)).toEqual(["x", "y", "z"])
    expect(plan.removalCandidates).toEqual([SIDE])
  })

  test("a CRLF T2 block is folded into the frontmatter", () => {
    const block = t2Block("2026-10-15", "n.md", '---\nk: "v"\n---\n').replace(/\n/g, "\r\n")
    const plan = planAdoption([{ path: SIDE, text: `x\r\n${block}` }], { currentText: "x\n", lastMaterialised: null, tombstoned: false, registers: soleRegisters("x\n") })
    const out = plan.rendered
    expect(out.includes("kept here so no fact is lost")).toBe(false)
    expect(renderedFacts(out).has("k")).toBe(true)
  })
})

describe("L2: the local-deletion shortcut", () => {
  test("a CRLF main whose text was deleted locally is still a local deletion", () => {
    const plan = planAdoption(
      [{ path: "n.md", text: "a\r\nc\r\n" }],
      { currentText: "a\nb\nc\n", lastMaterialised: "a\nb\nc\n", tombstoned: false, registers: soleRegisters("a\nb\nc\n") },
    )
    expect(plan.action).toBe("none")
  })

  test("a main that deleted whole lines is still a local deletion", () => {
    const plan = planAdoption(
      [{ path: "n.md", text: "a\nc\n" }],
      { currentText: "a\nb\nc\n", lastMaterialised: "a\nb\nc\n", tombstoned: false, registers: soleRegisters("a\nb\nc\n") },
    )
    expect(plan.action).toBe("none")
  })
})

const POOL = ["- likes tea", "- likes coffee", "abc", "ax", "note: alpha", "prefers 한글", "emoji 🙂", "-->", "--- not fm"] as const

type Built = {
  readonly text: string
  /** Lines that must survive verbatim: plain text, and every text line inside a malformed block. */
  readonly lines: readonly string[]
  /** Frontmatter and well-formed T2 values (registers and lists, some keys shared across files): each must be held. */
  readonly keys: readonly (readonly [string, unknown])[]
  /** Key lines inside malformed blocks: the line survives, or its key is represented. */
  readonly keyLines: ReadonlyMap<string, string>
  readonly malformed: boolean
}

/** A T2 block written by hand (no "-->" escaping), the shape the hub never emits. */
const handBlock = (kept: string): string =>
  `\n<!-- memory-sync 2026-10-15: the other machine had different frontmatter for n.md; kept here so no fact is lost:\n${kept}-->\n`

function build(rand: () => number, tag: string): Built {
  const lines: string[] = []
  const keys: [string, unknown][] = []
  const keyLines = new Map<string, string>()
  let malformed = false
  let text = ""
  if (rand() < 0.4) {
    keys.push(["shared", `v ${tag}`], ["tags", ["shared", tag]])
    text += `---\nshared: "v ${tag}"\ntags: [shared, "${tag}"]\n---\n`
  }
  const count = 1 + Math.floor(rand() * 5)
  for (let i = 0; i < count; i++) {
    const line = pick(rand, POOL)
    lines.push(line)
    text += `${line}\n`
    const roll = rand()
    const key = `k_${tag}_${i}`
    const value = `v ${tag} ${i}`
    let block = ""
    if (roll < 0.3) {
      const blockKey = rand() < 0.3 ? "shared" : key
      keys.push([blockKey, value])
      block = t2Block("2026-10-15", "n.md", `---\n${blockKey}: "${value}"\n---\n`)
    } else if (roll < 0.45) {
      malformed = true
      keyLines.set(key, `${key}: "${value}"`)
      const inner = rand() < 0.5 ? [`inside ${tag} ${i}`] : [`FACT ${tag} ${i} -->`, `more ${tag} ${i}`]
      lines.push(...inner)
      block = handBlock(`---\n${key}: "${value}"\n---\n${inner.map((l) => `${l}\n`).join("")}`)
    }
    if (block !== "") text += rand() < 0.5 ? block.slice(1) : block
  }
  return { text: rand() < 0.25 ? text.replace(/\n/g, "\r\n") : text, lines, keys, keyLines, malformed }
}

const LOSSY: readonly ((base: string, incoming: string) => string)[] = [
  (base, incoming) => [...new Set(linesOf(base + incoming))].map((line) => `${line}\n`).join(""),
  (base, incoming) => base + linesOf(incoming).slice(1).map((line) => `${line}\n`).join(""),
]

for (const seed of [20261016, 0x5eed4a11]) {
  test(`R1 every known fact of a deleted source survives: glued, malformed and hand-edited blocks, shared register and list keys, CRLF, duplicates, lossy merges; committed read-back; seed=${seed}`, async () => {
    const rand = mulberry32(seed)
    for (let iteration = 0; iteration < 1500; iteration++) {
      const base = "base line\n"
      const main = build(rand, `m${iteration}`)
      const sides = Array.from({ length: 1 + Math.floor(rand() * 2) }, (_, n) => ({
        path: `n.sync-conflict-20261015-${n === 0 ? "mac" : "mini"}.md`,
        built: build(rand, `s${iteration}-${n}`),
      }))
      const merge = rand() < 0.3 ? pick(rand, LOSSY) : undefined
      const files = [{ path: "n.md", text: main.text }, ...sides.map(({ path, built }) => ({ path, text: built.text }))]
      const doc = await newDoc("1")
      let out = ""
      let decision: RemovalDecision = { remove: [], retained: [] }
      try {
        captureInto(doc, "", [], base)
        const plan = planAdoption(files, { currentText: base, lastMaterialised: null, tombstoned: false, registers: activeRegisters(doc) }, merge)
        applyPlan(doc, base, plan)
        out = renderDocContent(doc)
        decision = confirmRemovals(doc, plan, files)
      } finally {
        doc.free()
      }
      const context = `R1 seed=${seed} case=${iteration} main=${JSON.stringify(main.text)} out=${JSON.stringify(out)}`
      const outLines = linesOf(splitItem(out).body)
      const facts = renderedFacts(out)
      for (const line of outLines) expect(line.startsWith("<!-- memory-sync frontmatter conflict"), `${context} marker in body`).toBe(false)
      for (const [key, value] of main.keys) expect(holdsValue(facts, key, value), `${context} main lost ${key}`).toBe(true)
      if (merge === undefined) {
        for (const line of main.lines) expect(outLines.includes(line), `${context} main lost ${line}`).toBe(true)
        if (!main.malformed && !sides.some(({ built }) => built.malformed)) {
          for (const line of outLines) expect(line.includes("kept here so no fact is lost"), `${context} block left in body`).toBe(false)
        }
      }
      const represented = (key: string, value: unknown): boolean => holdsValue(facts, key, value)
      for (const { path, built } of sides) {
        const where = `${context} side=${JSON.stringify(built.text)}`
        if (!decision.remove.includes(path)) {
          expect(decision.retained.map((entry) => entry.path), where).toContain(path)
          continue
        }
        for (const line of new Set(built.lines)) {
          expect(countOf(outLines, line) >= countOf(built.lines, line), `${where} deleted source lost ${line}`).toBe(true)
        }
        for (const [key, value] of built.keys) expect(represented(key, value), `${where} deleted source lost key ${key}`).toBe(true)
        for (const [key, line] of built.keyLines) {
          const value = line.slice(key.length + 3, -1)
          expect(outLines.includes(line) || represented(key, value), `${where} deleted source lost ${line}`).toBe(true)
        }
      }
    }
  }, PROPERTY_TIMEOUT_MS)
}
