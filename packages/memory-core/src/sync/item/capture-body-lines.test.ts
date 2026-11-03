import { describe, expect, test } from "bun:test"

import type { LoroDoc } from "../../crdt/loro-runtime"

import { captureItem } from "./capture"
import type { ItemDevice, ItemFrontier } from "./index"
import { captureOnDevice, createDeviceItemDoc, itemFrontier, renderItem } from "./index"
import { captureInto, mulberry32, newDoc, shuffled, withDevices } from "./test-support"

// #12279: the body merges at line granularity. Concurrent replacements of the same body line keep
// every replacement as a whole line (never a character splice of two edits), the replaced line is
// gone, untouched lines stay exactly once, and every device converges. Assertions compare whole
// lines, never substrings: a substring check is what let the character splice pass before.

const HDR = "---\ndescription: same-line\n---\n"

function bodyLines(doc: LoroDoc): string[] {
  const rendered = renderItem(doc) ?? ""
  expect(rendered.startsWith(HDR)).toBe(true)
  return rendered.slice(HDR.length).split("\n").sort()
}

function expectConverged(docs: readonly LoroDoc[], lines: readonly string[]): void {
  const first = docs[0]
  if (first === undefined) throw new Error("no doc")
  for (const doc of docs) expect(renderItem(doc)).toBe(renderItem(first))
  expect(bodyLines(first)).toEqual([...lines, ""].sort())
}

function exchange(docs: readonly LoroDoc[]): void {
  const updates = docs.map((doc) => doc.export({ mode: "update" }))
  for (const doc of docs) for (const update of updates) doc.import(update)
}

describe("concurrent replacements of one body line (#12279)", () => {
  for (const order of ["A then B", "B then A"] as const) {
    test(`two devices replace the same line from one baseline: both whole lines survive (${order})`, async () => {
      const docA = await newDoc("1")
      const docB = await newDoc("2")
      captureInto(docA, "", [], `${HDR}line from m13-a EDITED-ON-A\nline from m13-b EDITED-ON-B\n`)
      docB.import(docA.export({ mode: "update" }))
      const base = renderItem(docA) ?? ""
      const f1 = itemFrontier(docA)
      const updA = captureItem(docA, base, f1, `${HDR}SAME-LINE version A\nline from m13-b EDITED-ON-B\n`)
      const updB = captureItem(docB, base, f1, `${HDR}SAME-LINE version B\nline from m13-b EDITED-ON-B\n`)
      if (updA === null || updB === null) throw new Error("capture produced no update")
      const delivery = order === "A then B" ? [updA, updB] : [updB, updA]
      for (const doc of [docA, docB]) for (const update of delivery) doc.import(update)
      expectConverged([docA, docB], ["SAME-LINE version A", "SAME-LINE version B", "line from m13-b EDITED-ON-B"])
      docA.free()
      docB.free()
    })
  }

  // Drift: B's capture from the seed baseline already landed, so a replay from that baseline goes
  // through field-delta + the three-way merge. "synced first": A's replacement reached B before the
  // replay (the three-way merge sees both). "concurrent": it reaches B only afterwards.
  for (const when of ["synced first", "concurrent"] as const) {
    test(`a drifted replay replacing the line A also replaced keeps both whole lines (${when})`, async () => {
      await withDevices(2, async ([a, b]) => {
        if (a === undefined || b === undefined) throw new Error("no device")
        const seed = `${HDR}the meeting moved to Monday\nkeep me\n`
        const docA = await fire(a, await createDeviceItemDoc(a), "", [], seed)
        const docB = await createDeviceItemDoc(b)
        exchange([docA, docB])
        const fB = itemFrontier(docB)
        await fire(b, docB, seed, fB, `${seed}<X>\n`)
        await fire(a, docA, seed, itemFrontier(docA), `${HDR}the meeting moved to Tuesday\nkeep me\n`)
        if (when === "synced first") exchange([docA, docB])
        await fire(b, docB, seed, fB, `${HDR}the meeting moved to Thursday\nkeep me\n<X>\n`)
        exchange([docA, docB])
        expectConverged(
          [docA, docB],
          ["the meeting moved to Tuesday", "the meeting moved to Thursday", "keep me", "<X>"],
        )
        docA.free()
        docB.free()
      })
    })
  }

  // Guard, green on base by design (review C1): an LF-less body keeps the character diff, because
  // Loro's line unit includes its newline and a line diff there re-emits the old last line when one
  // device edits it while another terminates it and appends after it.
  test("an LF-less body: editing the last line while another device appends after it never resurrects the old line", async () => {
    const docA = await newDoc("1")
    const docB = await newDoc("2")
    captureInto(docA, "", [], `${HDR}x\nlast`)
    docB.import(docA.export({ mode: "update" }))
    const base = renderItem(docA) ?? ""
    const f1 = itemFrontier(docA)
    const updA = captureItem(docA, base, f1, `${HDR}x\nA-last`)
    const updB = captureItem(docB, base, f1, `${HDR}x\nlast\nnew`)
    if (updA === null || updB === null) throw new Error("capture produced no update")
    for (const doc of [docA, docB]) for (const update of [updA, updB]) doc.import(update)
    expect(renderItem(docA)).toBe(renderItem(docB))
    const lines = (renderItem(docA) ?? "").slice(HDR.length).split("\n")
    expect(lines).toContain("A-last")
    expect(lines).toContain("new")
    expect(lines).not.toContain("A-lastlast")
    docA.free()
    docB.free()
  })

  test("seeded property: replacements captured from the shared seed baseline all survive as whole lines on 2-3 devices, current or stale", async () => {
    const rand = mulberry32(12279)
    const days = ["Monday", "Tuesday", "Thursday", "Saturday", "Sunday"]
    for (let trial = 0; trial < 200; trial++) {
      const count = 2 + Math.floor(rand() * 2)
      const docs = await Promise.all(Array.from({ length: count }, (_, i) => newDoc(`${i + 1}`)))
      const lineCount = 3 + Math.floor(rand() * 4)
      const original = Array.from(
        { length: lineCount },
        (_, k) => `item ${k}: the meeting moved to ${days[k % days.length]}`,
      )
      const [first, ...rest] = docs
      if (first === undefined) throw new Error("no doc")
      captureInto(first, "", [], `${HDR}${original.join("\n")}\n`)
      for (const doc of rest) doc.import(first.export({ mode: "update" }))
      const base = renderItem(first) ?? ""
      const f1 = itemFrontier(first)
      const replaced = new Set<number>()
      const added: string[] = []
      const updates: Uint8Array[] = []
      for (const [i, doc] of docs.entries()) {
        if (rand() < 0.5) for (const update of updates) doc.import(update)
        const target = Math.floor(rand() * 2)
        const line = `item ${target}: the meeting moved to ${days[Math.floor(rand() * days.length)]} by d${i}`
        const working = original.map((l, k) => (k === target ? line : l))
        const update = captureItem(doc, base, f1, `${HDR}${working.join("\n")}\n`)
        if (update === null) throw new Error(`trial ${trial}: device ${i} captured nothing`)
        doc.import(update)
        updates.push(update)
        replaced.add(target)
        added.push(line)
      }
      for (const doc of docs) for (const update of shuffled(updates, rand)) doc.import(update)
      const kept = original.filter((_, k) => !replaced.has(k))
      const want = [...kept, ...added, ""].sort()
      for (const doc of docs) expect(bodyLines(doc), `trial ${trial}`).toEqual(want)
      for (const doc of docs) doc.free()
    }
  })
})

async function fire(
  device: ItemDevice,
  doc: LoroDoc,
  base: string,
  frontier: ItemFrontier,
  working: string,
): Promise<LoroDoc> {
  const update = await captureOnDevice(device, "item.md", doc, base, frontier, working)
  if (update !== null) doc.import(update)
  return doc
}
