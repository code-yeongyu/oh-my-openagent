import { describe, expect, test } from "bun:test"

import { deleteItem, isLive, itemFrontier, renderItem } from "./index"
import { captureCurrent, captureInto, newDoc, type Peer } from "./test-support"

let renderMergerSerial = 500
function renderMergerPeer(): Peer {
  renderMergerSerial += 1
  return String(renderMergerSerial) as Peer
}

describe("renderItem", () => {
  test("an empty document is not an item", async () => {
    const doc = await newDoc("1")
    expect(renderItem(doc)).toBeNull()
    expect(isLive(doc)).toBe(false)
    doc.free()
  })

  test("renders frontmatter keys in first-write order", async () => {
    const doc = await newDoc("1")
    const text = "---\nsecond: 2\nfirst: 1\n---\n"
    captureInto(doc, "", [], text)
    expect(renderItem(doc)).toBe(text)
    doc.free()
  })

  test("renders a set in first-add (lamport, peer) order across peers", async () => {
    const docA = await newDoc("1")
    captureInto(docA, "", [], "---\ntags:\n  - b\n---\n")
    const base = docA.export({ mode: "update" })

    const docB = await newDoc("2")
    docB.import(base)
    const forkB = docB.export({ mode: "update" })
    captureCurrent(docB, "---\ntags:\n  - b\n  - a\n---\n")

    const docC = await newDoc(renderMergerPeer())
    docC.import(forkB)
    docC.import(docA.export({ mode: "update" }))
    captureCurrent(docC, "---\ntags:\n  - b\n  - c\n---\n")

    docA.import(docB.export({ mode: "update" }))
    docA.import(docC.export({ mode: "update" }))

    const merged = renderItem(docA) ?? ""
    expect(["---\ntags:\n  - b\n  - a\n  - c\n---\n", "---\ntags:\n  - b\n  - c\n  - a\n---\n"]).toContain(merged)
    docB.import(docA.export({ mode: "update" }))
    docC.import(docA.export({ mode: "update" }))
    expect(renderItem(docB)).toBe(merged)
    expect(renderItem(docC)).toBe(merged)
    docA.free()
    docB.free()
    docC.free()
  })

  test("renders a register's concurrent values as one double-quoted string, UTF-8 sorted, joined with ' / ' (spec #454)", async () => {
    const docA = await newDoc("1")
    captureInto(docA, "", [], "---\ncount: 2\n---\n")
    const docB = await newDoc("2")
    captureInto(docB, "", [], "---\ncount: 10\n---\n")

    const updateA = docA.export({ mode: "update" })
    const updateB = docB.export({ mode: "update" })
    docA.import(updateB)
    docB.import(updateA)

    expect(renderItem(docA)).toBe('---\ncount: "10 / 2"\n---\n')
    expect(renderItem(docB)).toBe(renderItem(docA))
    docA.free()
    docB.free()
  })

  test("a dead item renders null and a recreated item renders only the new content", async () => {
    const doc = await newDoc("1")
    const v1 = "old text\n"
    captureInto(doc, "", [], v1)
    deleteItem(doc)
    expect(renderItem(doc)).toBeNull()
    captureInto(doc, v1, itemFrontier(doc), "reborn\n")
    expect(renderItem(doc)).toBe("reborn\n")
    doc.free()
  })

  test("unicode body edits are code-point safe", async () => {
    const doc = await newDoc("1")
    const v1 = "a🙂b\n"
    captureInto(doc, "", [], v1)
    const v2 = "a🙂🙂b\n"
    captureInto(doc, v1, itemFrontier(doc), v2)
    expect(renderItem(doc)).toBe(v2)
    const v3 = "🙂b\n"
    captureInto(doc, v2, itemFrontier(doc), v3)
    expect(renderItem(doc)).toBe(v3)
    doc.free()
  })

  test("an invalid-YAML file renders byte-exact", async () => {
    const doc = await newDoc("1")
    const bad = "---\n- just\n- a\n- list\n---\nkept whole\n"
    captureInto(doc, "", [], bad)
    expect(renderItem(doc)).toBe(bad)
    doc.free()
  })

  test("an empty frontmatter block is kept as body, not canonicalized away", async () => {
    const doc = await newDoc("1")
    const text = "---\n---\nbody\n"
    captureInto(doc, "", [], text)
    expect(renderItem(doc)).toBe(text)
    doc.free()
  })
})
