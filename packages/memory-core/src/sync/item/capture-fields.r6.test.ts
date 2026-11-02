import { describe, expect, test } from "bun:test"
import { parse as parseYaml } from "yaml"

import type { LoroDoc } from "../../crdt/loro-runtime"

import type { ItemDevice, ItemFrontier } from "./index"
import { captureOnDevice, createDeviceItemDoc, itemFrontier, recordMaterialized, renderItem } from "./index"
import { withDevices } from "./test-support"

// Reviews r5/r6 (oMo PR #10203, spec #454): through the capture entry point, concurrent and
// drifted edits keep each frontmatter field's kind. A register never holds a spliced value, a
// one-line string edited on two devices keeps both whole values, a list changed to a string is
// a whole-value replacement, and a value already written to disk is replaced cleanly.

async function fire(device: ItemDevice, doc: LoroDoc, base: string, frontier: ItemFrontier, working: string): Promise<void> {
  const update = await captureOnDevice(device, "item.md", doc, base, frontier, working)
  if (update !== null) doc.import(update)
}

async function seeded(device: ItemDevice, text: string): Promise<LoroDoc> {
  const doc = await createDeviceItemDoc(device)
  await fire(device, doc, "", [], text)
  return doc
}

function fieldValue(rendered: string, key: string): unknown {
  if (!rendered.startsWith("---\n")) return undefined
  const end = rendered.indexOf("\n---", 4)
  const header: unknown = parseYaml(rendered.slice(4, end))
  return typeof header === "object" && header !== null ? Object.entries(header).find(([k]) => k === key)?.[1] : undefined
}

function fieldParts(rendered: string, key: string): string[] {
  const value = fieldValue(rendered, key)
  return value === undefined ? [] : String(value).split(" / ")
}

function sync(a: LoroDoc, b: LoroDoc): void {
  const ua = a.export({ mode: "update" })
  const ub = b.export({ mode: "update" })
  a.import(ub)
  b.import(ua)
}

describe("reviews r5/r6: field kinds through the device entry point", () => {
  test("a drifted register edit never splices values: an unseen concurrent value stays a conflict", async () => {
    await withDevices(2, async ([a, b]) => {
      if (a === undefined || b === undefined) throw new Error("no device")
      const seed = "---\nn: 1\nf: true\n---\nbody\n"
      const docA = await seeded(a, seed)
      const docB = await createDeviceItemDoc(b)
      sync(docA, docB)
      const f0 = itemFrontier(docB)
      await fire(a, docA, seed, itemFrontier(docA), "---\nn: 2\nf: false\n---\nbody\n")
      sync(docA, docB)
      // B's disk still shows the seed; it captures a body edit, crashes, then the user edits the registers.
      await fire(b, docB, seed, f0, "---\nn: 1\nf: true\n---\nbody\n<X>\n")
      await fire(b, docB, seed, f0, "---\nn: 3\nf: 0\n---\nbody\n<X>\n")
      sync(docA, docB)
      const rendered = renderItem(docB) ?? ""
      expect(renderItem(docA)).toBe(rendered)
      expect(fieldParts(rendered, "n").sort()).toEqual(["2", "3"])
      expect(fieldParts(rendered, "f").sort()).toEqual(["0", "false"])
      expect(rendered.split("<X>").length - 1).toBe(1)
      docA.free()
      docB.free()
    })
  })

  test("r5 H1: a register edited on two devices, then a drifted replay, holds only whole written values", async () => {
    await withDevices(3, async ([a, b, c]) => {
      if (a === undefined || b === undefined || c === undefined) throw new Error("no device")
      const seed = "---\nn: 1\n---\nbody\n"
      const docA = await seeded(a, seed)
      const docB = await createDeviceItemDoc(b)
      const docC = await createDeviceItemDoc(c)
      sync(docA, docB)
      sync(docA, docC)
      const fB = itemFrontier(docB)
      await fire(a, docA, seed, itemFrontier(docA), "---\nn: 2\n---\nbody\n")
      await fire(c, docC, seed, itemFrontier(docC), "---\nn: 3\n---\nbody\n")
      sync(docA, docC)
      sync(docA, docB)
      // B's disk still shows the seed: a body edit is captured, then the user edits n and the capture replays.
      await fire(b, docB, seed, fB, "---\nn: 1\n---\nbody\n<X>\n")
      await fire(b, docB, seed, fB, "---\nn: hello\n---\nbody\n<X>\n")
      sync(docA, docB)
      sync(docB, docC)
      const rendered = renderItem(docB) ?? ""
      expect(renderItem(docA)).toBe(rendered)
      expect(renderItem(docC)).toBe(rendered)
      for (const part of fieldParts(rendered, "n")) expect(["2", "3", "hello"], `spliced register part ${part}`).toContain(part)
      expect(rendered.split("<X>").length - 1).toBe(1)
      docA.free()
      docB.free()
      docC.free()
    })
  })

  test("lead r6: concurrent edits to a one-line string field keep two whole values, never a mix", async () => {
    await withDevices(2, async ([a, b]) => {
      if (a === undefined || b === undefined) throw new Error("no device")
      const seed = "---\ndescription: the bird sat\n---\n"
      const docA = await seeded(a, seed)
      const docB = await createDeviceItemDoc(b)
      sync(docA, docB)
      await fire(a, docA, seed, itemFrontier(docA), "---\ndescription: the red bird sat\n---\n")
      await fire(b, docB, seed, itemFrontier(docB), "---\ndescription: the bird sat down\n---\n")
      sync(docA, docB)
      const rendered = renderItem(docA) ?? ""
      expect(renderItem(docB)).toBe(rendered)
      expect(fieldParts(rendered, "description").sort()).toEqual(["the bird sat down", "the red bird sat"])
      docA.free()
      docB.free()
    })
  })

  test("r5 M1: a drifted list-to-string change replaces the seen elements by the whole string", async () => {
    await withDevices(2, async ([a, b]) => {
      if (a === undefined || b === undefined) throw new Error("no device")
      const seed = "---\ntags:\n  - a\n---\nbody\n"
      const docA = await seeded(a, seed)
      const docB = await createDeviceItemDoc(b)
      sync(docA, docB)
      const fB = itemFrontier(docB)
      await fire(a, docA, seed, itemFrontier(docA), "---\ntags:\n  - a\n  - c\n---\nbody\n")
      sync(docA, docB)
      await fire(b, docB, seed, fB, "---\ntags:\n  - a\n---\nbody\n<X>\n")
      await fire(b, docB, seed, fB, "---\ntags: 'x: y'\n---\nbody\n<X>\n")
      sync(docA, docB)
      const rendered = renderItem(docB) ?? ""
      expect(renderItem(docA)).toBe(rendered)
      const tags = fieldValue(rendered, "tags")
      expect(Array.isArray(tags)).toBe(true)
      expect(Array.isArray(tags) ? [...tags].map(String).sort() : []).toEqual(["c", "x: y"])
      docA.free()
      docB.free()
    })
  })

  test("r5 M2: a value written to disk before a crash is replaced cleanly by the user's edit", async () => {
    await withDevices(2, async ([a, b]) => {
      if (a === undefined || b === undefined) throw new Error("no device")
      const seed = "---\nn: 1\n---\n"
      const docA = await seeded(a, seed)
      const docB = await createDeviceItemDoc(b)
      sync(docA, docB)
      const fB = itemFrontier(docB)
      await fire(a, docA, seed, itemFrontier(docA), "---\nn: 2\n---\n")
      sync(docA, docB)
      const written = renderItem(docB) ?? ""
      await recordMaterialized(b, "item.md", docB, fB, written)
      await fire(b, docB, seed, fB, "---\nn: 5\n---\n")
      sync(docA, docB)
      expect(renderItem(docB)).toBe("---\nn: 5\n---\n")
      expect(renderItem(docA)).toBe("---\nn: 5\n---\n")
      docA.free()
      docB.free()
    })
  })

})
