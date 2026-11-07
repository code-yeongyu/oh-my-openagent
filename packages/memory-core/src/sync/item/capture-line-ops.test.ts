import { describe, expect, test } from "bun:test"

import type { LoroDoc } from "../../crdt/loro-runtime"

import { captureItem } from "./capture"
import { itemFrontier, renderItem } from "./index"
import { captureInto, mulberry32, newDoc, shuffled } from "./test-support"

// #12279 / re-review of #12295: a body edit replaces whole lines in a way that cannot strand another
// device's concurrent insert on a line nobody edited. Devices on this build ("new") merge every edit as
// whole lines; a device on any earlier build ("old", a character diff of the body, which is exactly the
// pre-#12279 capture) keeps its fragments inside the line it edited. Lines are compared whole, never as
// substrings.

const HDR = "---\ndescription: line ops\n---\n"

type Build = "old" | "new"

interface Scenario {
  readonly name: string
  readonly base: string
  readonly a: string
  readonly b: string
  /** Lines neither side edited: they must survive whole in every pairing and order. */
  readonly untouched: readonly string[]
  readonly aLines: readonly string[]
  readonly bLines: readonly string[]
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: "same line",
    base: "the meeting moved to Monday\nkeep me\n",
    a: "the meeting moved to Tuesday\nkeep me\n",
    b: "the meeting moved to Thursday\nkeep me\n",
    untouched: ["keep me"],
    aLines: ["the meeting moved to Tuesday"],
    bLines: ["the meeting moved to Thursday"],
  },
  {
    name: "issue case",
    base: "top\nline from m13-a EDITED-ON-A\nline two\n",
    a: "top\nSAME-LINE version A\nline two\n",
    b: "top\nSAME-LINE version B\nline two\n",
    untouched: ["top", "line two"],
    aLines: ["SAME-LINE version A"],
    bLines: ["SAME-LINE version B"],
  },
  {
    name: "word edits",
    base: "alpha beta gamma\nnext line\n",
    a: "alpha FIRST beta gamma\nnext line\n",
    b: "alpha beta gamma LAST\nnext line\n",
    untouched: ["next line"],
    aLines: ["alpha FIRST beta gamma"],
    bLines: ["alpha beta gamma LAST"],
  },
  {
    name: "replace vs delete",
    base: "x\nthe old line\nkeep\n",
    a: "x\nthe new line\nkeep\n",
    b: "x\nkeep\n",
    untouched: ["x", "keep"],
    aLines: ["the new line"],
    bLines: [],
  },
  {
    name: "replace vs insert after",
    base: "x\nold line\nkeep\n",
    a: "x\nnew line\nkeep\n",
    b: "x\nold line\ninserted\nkeep\n",
    untouched: ["x", "keep"],
    aLines: ["new line"],
    bLines: ["inserted"],
  },
  {
    name: "adjacent lines",
    base: "head\none\ntwo\ntail\n",
    a: "head\nONE\ntwo\ntail\n",
    b: "head\none\nTWO\ntail\n",
    untouched: ["head", "tail"],
    aLines: ["ONE"],
    bLines: ["TWO"],
  },
  {
    name: "multi-line hunk",
    base: "head\none\ntwo\ntail\n",
    a: "head\nmerged one two\ntail\n",
    b: "head\none\ntwo edited\ntail\n",
    untouched: ["head", "tail"],
    aLines: ["merged one two"],
    bLines: ["two edited"],
  },
  {
    name: "first line",
    base: "first line\nkeep\n",
    a: "First Line A\nkeep\n",
    b: "first line b\nkeep\n",
    untouched: ["keep"],
    aLines: ["First Line A"],
    bLines: ["first line b"],
  },
  {
    name: "last line",
    base: "keep\nlast line\n",
    a: "keep\nlast line A\n",
    b: "keep\nLast B\n",
    untouched: ["keep"],
    aLines: ["last line A"],
    bLines: ["Last B"],
  },
  {
    name: "split vs edit",
    base: "x\nalpha beta\nkeep\n",
    a: "x\nalpha\nbeta\nkeep\n",
    b: "x\nalpha beta gamma\nkeep\n",
    untouched: ["x", "keep"],
    aLines: ["alpha", "beta"],
    bLines: ["alpha beta gamma"],
  },
  {
    name: "append vs edit last",
    base: "keep\nlast\n",
    a: "keep\nlast\nappended\n",
    b: "keep\nlast edited\n",
    untouched: ["keep"],
    aLines: ["appended"],
    bLines: ["last edited"],
  },
]

/** The pre-#12279 capture of a body edit: a character diff, under the doc's own peer. */
function oldCapture(doc: LoroDoc, body: string): Uint8Array {
  const fork = doc.fork()
  try {
    fork.setPeerId(doc.peerId)
    fork.setRecordTimestamp(false)
    fork.getText("body").update(body)
    fork.commit()
    return fork.export({ mode: "update", from: doc.oplogVersion() })
  } finally {
    fork.free()
  }
}

async function merge(s: Scenario, builds: readonly [Build, Build], aFirst: boolean): Promise<string[]> {
  const docA = await newDoc("1")
  const docB = await newDoc("2")
  captureInto(docA, "", [], `${HDR}${s.base}`)
  docB.import(docA.export({ mode: "update" }))
  const base = renderItem(docA) ?? ""
  const f1 = itemFrontier(docA)
  const edit = (doc: LoroDoc, build: Build, body: string): Uint8Array => {
    if (build === "old") return oldCapture(doc, body)
    const update = captureItem(doc, base, f1, `${HDR}${body}`)
    if (update === null) throw new Error("capture produced no update")
    return update
  }
  const updA = edit(docA, builds[0], s.a)
  const updB = edit(docB, builds[1], s.b)
  for (const doc of [docA, docB]) for (const update of aFirst ? [updA, updB] : [updB, updA]) doc.import(update)
  const out = [renderItem(docA) ?? "", renderItem(docB) ?? ""]
  docA.free()
  docB.free()
  return out
}

const bodyLines = (rendered: string): string[] => rendered.slice(HDR.length).split("\n")

describe("line ops merge without touching an unedited line, in every build pairing and order", () => {
  const pairings: readonly (readonly [Build, Build])[] = [
    ["new", "new"],
    ["new", "old"],
    ["old", "new"],
  ]
  for (const s of SCENARIOS) {
    for (const builds of pairings) {
      for (const aFirst of [true, false]) {
        test(`${s.name}: A ${builds[0]}, B ${builds[1]}, ${aFirst ? "A then B" : "B then A"}`, async () => {
          const [onA, onB] = await merge(s, builds, aFirst)
          expect(onA).toBe(onB)
          // An old device's edit inside a line this build deletes has no newline left to sit on: the
          // fragments land on the next line exactly as they do between two old devices.
          if (s.name === "replace vs delete" && builds[0] === "old") {
            const [oldOld] = await merge(s, ["old", "old"], aFirst)
            expect(onA).toBe(oldOld)
            return
          }
          const lines = bodyLines(onA ?? "")
          for (const line of s.untouched) expect(lines, `untouched line ${line}`).toContain(line)
          if (builds[0] === "new" && builds[1] === "new") {
            for (const line of [...s.aLines, ...s.bLines]) expect(lines, `line ${line}`).toContain(line)
            return
          }
          // Against an older build the new edit's text stays contiguous; the older device's fragments
          // may join it on the edited line (design 11.7).
          for (const line of builds[0] === "new" ? s.aLines : s.bLines)
            expect(onA, `new build's text ${line}`).toContain(line)
        })
      }
    }
  }
})

describe("an older device prepends to the line right after this build's hunk", () => {
  // Same Fugue origins as this build's new lines, so the peer order decides where the prefix lands
  // (design 11.3): both texts survive, and the result is one of the two documented outcomes.
  for (const [newPeer, oldPeer] of [
    ["1", "2"],
    ["2", "1"],
  ] as const) {
    test(`new peer ${newPeer}, old peer ${oldPeer}`, async () => {
      const docN = await newDoc(newPeer)
      const docO = await newDoc(oldPeer)
      captureInto(docN, "", [], `${HDR}a\nb\n`)
      docO.import(docN.export({ mode: "update" }))
      const updN = captureItem(docN, renderItem(docN) ?? "", itemFrontier(docN), `${HDR}A\nb\n`)
      if (updN === null) throw new Error("capture produced no update")
      const updO = oldCapture(docO, "a\nXb\n")
      for (const doc of [docN, docO]) for (const update of [updN, updO]) doc.import(update)
      expect(renderItem(docN)).toBe(renderItem(docO))
      expect([`${HDR}A\nXb\n`, `${HDR}XA\nb\n`]).toContain(renderItem(docN) ?? "")
      docN.free()
      docO.free()
    })
  }
})

describe("line ops between devices on this build (seeded property)", () => {
  test("every line no device touched survives whole, every written line survives whole, all converge", async () => {
    const rand = mulberry32(122950)
    for (let trial = 0; trial < 200; trial++) {
      const count = 2 + Math.floor(rand() * 2)
      const docs = await Promise.all(Array.from({ length: count }, (_, i) => newDoc(`${i + 1}`)))
      const size = 4 + Math.floor(rand() * 5)
      const original = Array.from({ length: size }, (_, k) => `line ${k} of the shared note`)
      const [first, ...rest] = docs
      if (first === undefined) throw new Error("no doc")
      captureInto(first, "", [], `${HDR}${original.join("\n")}\n`)
      for (const doc of rest) doc.import(first.export({ mode: "update" }))
      const base = renderItem(first) ?? ""
      const f1 = itemFrontier(first)
      const touched = new Set<number>()
      const written: string[] = []
      const updates: Uint8Array[] = []
      for (const [i, doc] of docs.entries()) {
        if (rand() < 0.5) for (const update of updates) doc.import(update)
        const target = Math.floor(rand() * size)
        const op = Math.floor(rand() * 4)
        const mine = `d${i} t${trial} of the shared note`
        const working = original.flatMap((line, k): string[] => {
          if (k !== target) return [line]
          if (op === 0) return [`replaced ${mine}`]
          if (op === 1) return []
          if (op === 2) return [line, `inserted ${mine}`]
          return [`split head ${mine}`, `split tail ${mine}`]
        })
        if (op !== 2) touched.add(target)
        if (op === 0) written.push(`replaced ${mine}`)
        if (op === 2) written.push(`inserted ${mine}`)
        if (op === 3) written.push(`split head ${mine}`, `split tail ${mine}`)
        // A stale device whose edit is already in the updates it imported (the same delete) captures nothing.
        const update = captureItem(doc, base, f1, `${HDR}${working.join("\n")}\n`)
        if (update === null) continue
        doc.import(update)
        updates.push(update)
      }
      for (const doc of docs) for (const update of shuffled(updates, rand)) doc.import(update)
      const rendered = renderItem(first) ?? ""
      for (const doc of docs) expect(renderItem(doc), `trial ${trial}`).toBe(rendered)
      const lines = bodyLines(rendered)
      for (const [k, line] of original.entries())
        if (!touched.has(k)) expect(lines, `trial ${trial} untouched ${line}`).toContain(line)
      for (const line of written) expect(lines, `trial ${trial} written ${line}`).toContain(line)
      for (const doc of docs) doc.free()
    }
  })
})

describe("spread-out edits on a long note stay line-exact (review of #12295 at 75a943f4fc)", () => {
  // Two single-line edits about 2,000 lines apart on one device (edit near the top, append at the
  // bottom) must stay two small hunks: no untouched line duplicated, no replaced line brought back.
  const size = 2_100
  const original = Array.from({ length: size }, (_, k) => `note line ${k}`)
  const body = (lines: readonly string[]): string => `${HDR}${lines.join("\n")}\n`
  const countOf = (lines: readonly string[], line: string): number => lines.filter((l) => l === line).length

  async function concurrent(a: readonly string[], b: readonly string[]): Promise<string[]> {
    const docA = await newDoc("1")
    const docB = await newDoc("2")
    captureInto(docA, "", [], body(original))
    docB.import(docA.export({ mode: "update" }))
    const base = renderItem(docA) ?? ""
    const f1 = itemFrontier(docA)
    const updA = captureItem(docA, base, f1, body(a))
    const updB = captureItem(docB, base, f1, body(b))
    if (updA === null || updB === null) throw new Error("capture produced no update")
    for (const doc of [docA, docB]) for (const update of [updA, updB]) doc.import(update)
    expect(renderItem(docA)).toBe(renderItem(docB))
    const out = bodyLines(renderItem(docA) ?? "")
    docA.free()
    docB.free()
    return out
  }

  const topAndAppend = (tag: string): string[] => [`TOP ${tag}`, ...original.slice(1), `appended ${tag}`]

  test("both devices edit near the top and append at the bottom: every untouched line exactly once", async () => {
    const lines = await concurrent(topAndAppend("A"), topAndAppend("B"))
    for (const line of original.slice(1)) expect(countOf(lines, line), line).toBe(1)
    for (const line of ["TOP A", "TOP B", "appended A", "appended B"]) expect(countOf(lines, line), line).toBe(1)
  })

  test("one device spreads its edits, the other replaces a middle line: the replaced line stays gone", async () => {
    const b = original.map((line, k) => (k === 1_000 ? "middle replaced by B" : line))
    const lines = await concurrent(topAndAppend("A"), b)
    expect(countOf(lines, "note line 1000")).toBe(0)
    expect(countOf(lines, "middle replaced by B")).toBe(1)
    for (const line of original.slice(1)) if (line !== "note line 1000") expect(countOf(lines, line), line).toBe(1)
  })
})
