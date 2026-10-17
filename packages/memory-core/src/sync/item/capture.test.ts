import { describe, expect, test } from "bun:test"

import { CaptureBaselineError, itemFrontier, renderItem } from "./index"
import { captureItem } from "./capture"
import { captureCurrent, captureInto, mulberry32, newDoc } from "./test-support"

describe("captureItem", () => {
  test("creates a new item from an empty baseline", async () => {
    const doc = await newDoc("1")
    const text = "---\ndescription: hello\n---\nbody text\n"
    const update = captureInto(doc, "", [], text)
    expect(update).not.toBeNull()
    expect(renderItem(doc)).toBe(text)
    doc.free()
  })

  test("produces zero ops when the working text equals the baseline", async () => {
    const doc = await newDoc("1")
    const text = "---\ndescription: hello\n---\nbody text\n"
    captureInto(doc, "", [], text)
    expect(captureItem(doc, text, itemFrontier(doc), text)).toBeNull()
    doc.free()
  })

  test("edits the body only", async () => {
    const doc = await newDoc("1")
    const v1 = "---\ndescription: hello\n---\nbody text\n"
    captureInto(doc, "", [], v1)
    const v2 = "---\ndescription: hello\n---\nbody text\nmore\n"
    captureInto(doc, v1, itemFrontier(doc), v2)
    expect(renderItem(doc)).toBe(v2)
    doc.free()
  })

  test("edits a frontmatter string value", async () => {
    const doc = await newDoc("1")
    const v1 = "---\ndescription: hello\n---\nbody\n"
    captureInto(doc, "", [], v1)
    const v2 = "---\ndescription: world\n---\nbody\n"
    captureInto(doc, v1, itemFrontier(doc), v2)
    expect(renderItem(doc)).toBe(v2)
    doc.free()
  })

  test("adds a typed key as a register and renders it verbatim", async () => {
    const doc = await newDoc("1")
    const v1 = "---\ndescription: hello\n---\nbody\n"
    captureInto(doc, "", [], v1)
    const v2 = "---\ndescription: hello\ncount: 2\n---\nbody\n"
    captureInto(doc, v1, itemFrontier(doc), v2)
    expect(renderItem(doc)).toBe(v2)
    doc.free()
  })

  test("adds a list key as a set rendered as a block sequence", async () => {
    const doc = await newDoc("1")
    const v1 = "---\ndescription: hello\n---\nbody\n"
    captureInto(doc, "", [], v1)
    const v2 = "---\ndescription: hello\ntags:\n  - a\n  - b\n---\nbody\n"
    captureInto(doc, v1, itemFrontier(doc), v2)
    expect(renderItem(doc)).toBe(v2)
    doc.free()
  })

  test("removes a frontmatter key", async () => {
    const doc = await newDoc("1")
    const v1 = "---\ndescription: hello\ncount: 2\n---\nbody\n"
    captureInto(doc, "", [], v1)
    const v2 = "---\ndescription: hello\n---\nbody\n"
    captureInto(doc, v1, itemFrontier(doc), v2)
    expect(renderItem(doc)).toBe(v2)
    doc.free()
  })

  test("keeps an invalid-YAML file as the whole body, byte-exact", async () => {
    const doc = await newDoc("1")
    const bad = "---\n: nope: [\n---\nrest\n"
    captureInto(doc, "", [], bad)
    expect(renderItem(doc)).toBe(bad)
    doc.free()
  })

  test("switching a file to invalid YAML moves everything into the body", async () => {
    const doc = await newDoc("1")
    const v1 = "---\ndescription: hello\n---\nbody\n"
    captureInto(doc, "", [], v1)
    const bad = "---\ndescription: [unclosed\n---\nbody\n"
    captureInto(doc, v1, itemFrontier(doc), bad)
    expect(renderItem(doc)).toBe(bad)
    doc.free()
  })

  test("a stale baseline never deletes text it never saw", async () => {
    const docA = await newDoc("1")
    const v1 = "---\ndescription: d\n---\nalpha beta gamma\n"
    captureInto(docA, "", [], v1)
    const f1 = itemFrontier(docA)

    const docB = await newDoc("2")
    docB.import(docA.export({ mode: "update" }))

    const vA = "---\ndescription: d\n---\nalpha FIRST beta gamma\n"
    captureInto(docA, v1, itemFrontier(docA), vA)

    const vB = "---\ndescription: d\n---\nalpha beta gamma LAST\n"
    const updateB = captureItem(docB, v1, f1, vB)
    expect(updateB).not.toBeNull()
    if (updateB !== null) docA.import(updateB)

    expect(renderItem(docA)).toBe("---\ndescription: d\n---\nalpha FIRST beta gamma LAST\n")
    docA.free()
    docB.free()
  })

  test("a stale writer's wholesale delete cannot remove concurrent inserts", async () => {
    const docA = await newDoc("1")
    const v1 = "old body\n"
    captureInto(docA, "", [], v1)
    const f1 = itemFrontier(docA)

    const docB = await newDoc("2")
    docB.import(docA.export({ mode: "update" }))

    captureInto(docA, v1, itemFrontier(docA), "NEW old body\n")

    const updateB = captureItem(docB, v1, f1, "fresh\n")
    expect(updateB).not.toBeNull()
    if (updateB !== null) docA.import(updateB)

    const rendered = renderItem(docA)
    expect(rendered).toContain("NEW")
    expect(rendered).toContain("fresh")
    docA.free()
    docB.free()
  })

  test("throws CaptureBaselineError when baseText disagrees with the fork state", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], "real base\n")
    let caught: unknown
    try {
      captureItem(doc, "wrong base\n", itemFrontier(doc), "anything\n")
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(CaptureBaselineError)
    doc.free()
  })

  test("re-typing a key converts into its fixed first-write kind (strings and numbers are both registers)", async () => {
    const doc = await newDoc("1")
    const v1 = "---\nkey: hello\n---\n"
    captureInto(doc, "", [], v1)
    captureInto(doc, v1, itemFrontier(doc), "---\nkey: 7\n---\n")
    expect(renderItem(doc)).toBe("---\nkey: 7\n---\n")
    captureInto(doc, "---\nkey: 7\n---\n", itemFrontier(doc), "---\nkey:\n  - a\n  - b\n---\n")
    // A lone register holding a whole list renders it verbatim as a list (spec #454).
    expect(renderItem(doc)).toBe("---\nkey: [ a, b ]\n---\n")
    expect(captureCurrent(doc, renderItem(doc) ?? "")).toBeNull()
    doc.free()
    const set = await newDoc("1")
    captureInto(set, "", [], "---\ntags:\n  - a\n---\n")
    captureInto(set, "---\ntags:\n  - a\n---\n", itemFrontier(set), "---\ntags: 'x: y'\n---\n")
    expect(renderItem(set)).toBe('---\ntags:\n  - "x: y"\n---\n')
    expect(captureCurrent(set, renderItem(set) ?? "")).toBeNull()
    set.free()
  })

  test("N sequential captures from one device on one stale baseline lose no edit", async () => {
    const rand = mulberry32(7)
    for (let trial = 0; trial < 40; trial++) {
      const doc = await newDoc("1")
      captureInto(doc, "", [], "hello\n")
      const f1 = itemFrontier(doc)
      const base = renderItem(doc) ?? ""
      const count = 2 + Math.floor(rand() * 4)
      const markers: string[] = []
      for (let i = 0; i < count; i++) {
        const marker = `E${trial}_${i}_${Math.floor(rand() * 1e6)}`
        markers.push(marker)
        const update = captureItem(doc, base, f1, `hello ${marker}\n`)
        if (update !== null) doc.import(update)
      }
      const rendered = renderItem(doc) ?? ""
      for (const marker of markers) expect(rendered, `trial ${trial} lost edit ${marker}`).toContain(marker)
      doc.free()
    }
  })

  test("interleaved captures from two devices on one baseline lose no edit", async () => {
    const rand = mulberry32(11)
    for (let trial = 0; trial < 30; trial++) {
      const docA = await newDoc("1")
      const docB = await newDoc("2")
      captureInto(docA, "", [], "seed\n")
      docB.import(docA.export({ mode: "update" }))
      const f1 = itemFrontier(docA)
      const base = renderItem(docA) ?? ""
      const rounds = 2 + Math.floor(rand() * 3)
      const markers: string[] = []
      for (let round = 0; round < rounds; round++) {
        const mkA = `A${trial}_${round}_${Math.floor(rand() * 1e6)}`
        const mkB = `B${trial}_${round}_${Math.floor(rand() * 1e6)}`
        const updA = captureItem(docA, base, f1, `seed ${mkA}\n`)
        if (updA !== null) docA.import(updA)
        const updB = captureItem(docB, base, f1, `seed ${mkB}\n`)
        if (updB !== null) docB.import(updB)
        if (updA !== null) docB.import(updA)
        if (updB !== null) docA.import(updB)
        markers.push(mkA, mkB)
      }
      const rendered = renderItem(docA) ?? ""
      expect(rendered).toBe(renderItem(docB) ?? "")
      for (const marker of markers) expect(rendered, `trial ${trial} lost edit ${marker}`).toContain(marker)
      docA.free()
      docB.free()
    }
  })
})
