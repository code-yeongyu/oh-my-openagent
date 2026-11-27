import { describe, expect, test } from "bun:test"

import type { LoroDoc } from "../../crdt/loro-runtime"

import { itemFrontier, renderItem, splitItem } from "./index"
import { captureItem } from "./capture"
import { captureInto, newDoc, mulberry32, type Peer } from "./test-support"

function peer(n: number): Peer {
  return String(n) as Peer
}

// review r2 (oMo PR #10203): every merged render must be valid frontmatter whose
// re-capture is a zero-op fixed point, and a stale writer must never drop or duplicate
// content a concurrent writer already landed. These cases are deterministic reproductions
// of the peer orders that the r1 fixes left broken.

function assertFixedPoint(doc: LoroDoc, rendered: string): void {
  expect(splitItem(rendered).fm, `not valid frontmatter: ${JSON.stringify(rendered)}`).not.toBeNull()
  const again = captureItem(doc, rendered, itemFrontier(doc), rendered)
  expect(again, `re-capture is not a no-op: ${JSON.stringify(rendered)}`).toBeNull()
}

describe("review r2: joins survive render and re-capture as one scalar", () => {
  test("r2 #1 verbatim reg + text join: bytes stay identical through capture, valid YAML", async () => {
    // register first-write (verbatim 'q: r') concurrent with a text write, merged in both
    // delivery orders. The joined render must re-capture as a zero-op fixed point.
    for (let seed = 0; seed < 12; seed++) {
      const docA = await newDoc("1")
      captureInto(docA, "", [], "---\nflag: 'q: r'\n---\n")
      const docB = await newDoc("2")
      captureInto(docB, "", [], "---\nflag: true\n---\n")
      const ab = await newDoc(peer(100 + seed))
      ab.import(docA.export({ mode: "update" }))
      ab.import(docB.export({ mode: "update" }))
      const ba = await newDoc(peer(200 + seed))
      ba.import(docB.export({ mode: "update" }))
      ba.import(docA.export({ mode: "update" }))
      const rendered = renderItem(ab) ?? ""
      expect(renderItem(ba) ?? "", "delivery orders diverge").toBe(rendered)
      assertFixedPoint(ab, rendered)
      for (const token of ["q: r", "true"]) expect(rendered).toContain(token)
      for (const doc of [ab, ba, docA, docB]) doc.free()
    }
  })

  test("r2 #2 text stale-wins drop: a stale text capture must not delete the winning register", async () => {
    const store = await newDoc("1")
    captureInto(store, "", [], "---\nflag: true\n---\n")
    const f1 = itemFrontier(store)
    // Fresh capture flips the value to a colon-bearing register string.
    const v2 = captureItem(store, "---\nflag: true\n---\n", f1, "---\nflag: 'q: r'\n---\n")
    if (v2) store.import(v2)
    // Stale capture from the same baseline writes the same register text.
    const v3 = captureItem(store, "---\nflag: true\n---\n", f1, "---\nflag: 'q: r'\n---\n")
    if (v3) store.import(v3)
    const rendered = renderItem(store) ?? ""
    // The register content must survive exactly once; the stale capture must not
    // re-install a duplicate or a quoted-quoted variant.
    const matches = rendered.match(/q: r/g) ?? []
    expect(matches.length, `stale capture duplicated/dropped: ${JSON.stringify(rendered)}`).toBe(1)
    assertFixedPoint(store, rendered)
    store.free()
  })

  test("r2 #3 set join keeps a bare pinned element that needs quoting", async () => {
    const docA = await newDoc("1")
    captureInto(docA, "", [], "---\ntags:\n  - x\n---\n")
    const docB = await newDoc("2")
    captureInto(docB, "", [], "---\ntags: 'a / b / c'\n---\n")
    const m = await newDoc("9")
    m.import(docA.export({ mode: "update" }))
    m.import(docB.export({ mode: "update" }))
    const rendered = renderItem(m) ?? ""
    assertFixedPoint(m, rendered)
    for (const token of ["x", "a / b / c"]) expect(rendered).toContain(token)
    m.free()
    docA.free()
    docB.free()
  })

  test("r2 conformance: 300 seeded merges render valid frontmatter with a zero-op re-capture", async () => {
    // Widens the roundtrip generator gap: text+register joins are exercised directly.
    let checked = 0
    for (let seed = 0; seed < 300; seed++) {
      const docA = await newDoc("1")
      captureInto(docA, "", [], "---\nflag: true\n---\n")
      const docB = await newDoc("2")
      captureInto(docB, "", [], "---\nflag: 'q: r'\n---\n")
      const m = await newDoc(peer(1000 + seed))
      m.import(docA.export({ mode: "update" }))
      m.import(docB.export({ mode: "update" }))
      const rendered = renderItem(m) ?? ""
      assertFixedPoint(m, rendered)
      checked++
      for (const d of [m, docA, docB]) d.free()
    }
    expect(checked).toBe(300)
  })
})
