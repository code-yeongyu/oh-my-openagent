import { describe, expect, test } from "bun:test"

import { deleteItem, isLive, itemFrontier, renderItem } from "./index"
import { captureItem } from "./capture"
import { captureInto, newDoc } from "./test-support"

describe("tombstones (sync-design §4)", () => {
  test("a deleted item is not live and renders null", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], "---\ndescription: d\n---\nbody\n")
    expect(isLive(doc)).toBe(true)
    deleteItem(doc)
    expect(isLive(doc)).toBe(false)
    expect(renderItem(doc)).toBeNull()
    doc.free()
  })

  test("an edit concurrent with a delete keeps the item, whole, with the edit", async () => {
    const docA = await newDoc("1")
    const v1 = "hello\n"
    captureInto(docA, "", [], v1)
    const f1 = itemFrontier(docA)

    const docB = await newDoc("2")
    docB.import(docA.export({ mode: "update" }))

    deleteItem(docA)
    expect(isLive(docA)).toBe(false)

    const editB = captureItem(docB, v1, f1, "hello world\n")
    expect(editB).not.toBeNull()
    if (editB !== null) docA.import(editB)

    expect(isLive(docA)).toBe(true)
    expect(renderItem(docA)).toBe("hello world\n")
    docA.free()
    docB.free()
  })

  test("an unchanged stale capture produces no ops and never revives the item", async () => {
    const docA = await newDoc("1")
    const v1 = "hello\n"
    captureInto(docA, "", [], v1)
    const f1 = itemFrontier(docA)

    const docB = await newDoc("2")
    docB.import(docA.export({ mode: "update" }))

    deleteItem(docA)

    expect(captureItem(docB, v1, f1, v1)).toBeNull()
    docA.import(docB.export({ mode: "update" }))
    expect(isLive(docA)).toBe(false)
    expect(renderItem(docA)).toBeNull()
    docA.free()
    docB.free()
  })

  test("re-creating a deleted path keeps only the new content", async () => {
    const doc = await newDoc("1")
    const v1 = "---\ndescription: d\n---\nold\n"
    captureInto(doc, "", [], v1)
    deleteItem(doc)
    expect(isLive(doc)).toBe(false)

    // The tombstone keeps the characters, so the content render at the CURRENT frontier
    // still equals the last materialised text; the recreate diff lands after it.
    captureInto(doc, v1, itemFrontier(doc), "---\ndescription: d\n---\nnew\n")
    expect(isLive(doc)).toBe(true)
    expect(renderItem(doc)).toBe("---\ndescription: d\n---\nnew\n")
    doc.free()
  })

  test("two deletes from two peers stay dead", async () => {
    const docA = await newDoc("1")
    const v1 = "doomed\n"
    captureInto(docA, "", [], v1)

    const docB = await newDoc("2")
    docB.import(docA.export({ mode: "update" }))

    deleteItem(docA)
    deleteItem(docB)

    docA.import(docB.export({ mode: "update" }))
    docB.import(docA.export({ mode: "update" }))

    expect(isLive(docA)).toBe(false)
    expect(isLive(docB)).toBe(false)
    docA.free()
    docB.free()
  })

  test("a delete by one peer covers the other peer's already-applied edits", async () => {
    const docA = await newDoc("1")
    captureInto(docA, "", [], "v1\n")

    const docB = await newDoc("2")
    docB.import(docA.export({ mode: "update" }))
    const v2 = "v1\nv2\n"
    captureInto(docB, "v1\n", itemFrontier(docB), v2)

    docA.import(docB.export({ mode: "update" }))
    expect(renderItem(docA)).toBe(v2)

    deleteItem(docA)
    docB.import(docA.export({ mode: "update" }))
    expect(isLive(docB)).toBe(false)
    expect(renderItem(docB)).toBeNull()
    docA.free()
    docB.free()
  })
})
