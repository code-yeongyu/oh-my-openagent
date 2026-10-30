import { describe, expect, test } from "bun:test"

import type { LoroDoc } from "../../crdt/loro-runtime"

import type { ItemDevice, ItemFrontier } from "./index"
import { captureOnDevice, createDeviceItemDoc, itemFrontier, recordMaterialized, renderItem } from "./index"
import { withDevices } from "./test-support"

// Reviews r3/r4 (oMo PR #10203): through the capture entry point, an edit is applied exactly
// once however the capture is replayed: identical double-fires, a crash followed by more
// typing, a crash before the update was imported, a synced edit written to disk before a
// crash, and an older baseline replayed after a newer one. A hand-resolved register conflict
// survives the next capture and a sync on both devices.

async function fire(device: ItemDevice, doc: LoroDoc, base: string, frontier: ItemFrontier, working: string): Promise<void> {
  const update = await captureOnDevice(device, "item.md", doc, base, frontier, working)
  if (update !== null) doc.import(update)
}

async function seeded(device: ItemDevice, text: string): Promise<LoroDoc> {
  const doc = await createDeviceItemDoc(device)
  await fire(device, doc, "", [], text)
  return doc
}

function sync(a: LoroDoc, b: LoroDoc): void {
  const ua = a.export({ mode: "update" })
  const ub = b.export({ mode: "update" })
  a.import(ub)
  b.import(ua)
}

describe("reviews r3/r4: capture through the device entry point applies each edit once", () => {
  test("an identical double-fire and a crash replay apply the body edit once", async () => {
    await withDevices(1, async ([device]) => {
      if (device === undefined) throw new Error("no device")
      const doc = await seeded(device, "line1\n")
      const f1 = itemFrontier(doc)
      await fire(device, doc, "line1\n", f1, "line1\nline2\n")
      expect(await captureOnDevice(device, "item.md", doc, "line1\n", f1, "line1\nline2\n")).toBeNull()
      expect(renderItem(doc)).toBe("line1\nline2\n")
      doc.free()
    })
  })

  test("a frontmatter double-fire does not duplicate the value", async () => {
    await withDevices(1, async ([device]) => {
      if (device === undefined) throw new Error("no device")
      const v1 = "---\ndescription: hi\n---\n"
      const doc = await seeded(device, v1)
      const f1 = itemFrontier(doc)
      const v2 = "---\ndescription: hi there\n---\n"
      await fire(device, doc, v1, f1, v2)
      await fire(device, doc, v1, f1, v2)
      expect(renderItem(doc)).toBe(v2)
      doc.free()
    })
  })

  test("a crash, then more typing, then N drifted replays from the old baseline apply every edit once", async () => {
    await withDevices(1, async ([device]) => {
      if (device === undefined) throw new Error("no device")
      const doc = await seeded(device, "hello\n")
      const f0 = itemFrontier(doc)
      let disk = "hello\n"
      for (const word of ["<A>", "<B>", "<C>", "<D>"]) {
        disk = `${disk}${word}\n`
        await fire(device, doc, "hello\n", f0, disk)
        await fire(device, doc, "hello\n", f0, disk)
      }
      expect(renderItem(doc)).toBe("hello\n<A>\n<B>\n<C>\n<D>\n")
      doc.free()
    })
  })

  test("a crash before the update was imported loses nothing and duplicates nothing", async () => {
    await withDevices(1, async ([device]) => {
      if (device === undefined) throw new Error("no device")
      const doc = await seeded(device, "base\n")
      const f0 = itemFrontier(doc)
      const dropped = await captureOnDevice(device, "item.md", doc, "base\n", f0, "base\n<A>\n")
      expect(dropped).not.toBeNull()
      await fire(device, doc, "base\n", f0, "base\n<A>\n<B>\n")
      expect(renderItem(doc)).toBe("base\n<A>\n<B>\n")
      doc.free()
    })
  })

  test("a synced edit written to disk, then a crash, then typing applies the synced edit once", async () => {
    await withDevices(2, async ([a, b]) => {
      if (a === undefined || b === undefined) throw new Error("no device")
      const docA = await seeded(a, "t\n")
      const docB = await createDeviceItemDoc(b)
      sync(docA, docB)
      const fB = itemFrontier(docB)
      await fire(a, docA, "t\n", itemFrontier(docA), "t\n<X>\n")
      sync(docA, docB)
      const written = renderItem(docB) ?? ""
      await recordMaterialized(b, "item.md", docB, fB, written)
      // B crashed before saving the new baseline; its user types on top of the written file.
      await fire(b, docB, "t\n", fB, `${written}<Y>\n`)
      sync(docA, docB)
      expect(renderItem(docB)).toBe("t\n<X>\n<Y>\n")
      expect(renderItem(docA)).toBe("t\n<X>\n<Y>\n")
      docA.free()
      docB.free()
    })
  })

  test("an older baseline replayed after a newer capture is a no-op", async () => {
    await withDevices(1, async ([device]) => {
      if (device === undefined) throw new Error("no device")
      const doc = await seeded(device, "x\n")
      const f0 = itemFrontier(doc)
      await fire(device, doc, "x\n", f0, "x\n<A>\n")
      await fire(device, doc, "x\n<A>\n", itemFrontier(doc), "x\n<A>\n<B>\n")
      expect(await captureOnDevice(device, "item.md", doc, "x\n", f0, "x\n<A>\n")).toBeNull()
      expect(renderItem(doc)).toBe("x\n<A>\n<B>\n")
      doc.free()
    })
  })

  test("a hand-resolved register conflict survives the next capture and sync on both devices", async () => {
    await withDevices(2, async ([a, b]) => {
      if (a === undefined || b === undefined) throw new Error("no device")
      const docA = await seeded(a, "---\nn: 2\n---\n")
      const docB = await seeded(b, "---\nn: 3\n---\n")
      sync(docA, docB)
      const conflicted = renderItem(docA) ?? ""
      expect(renderItem(docB)).toBe(conflicted)
      expect(conflicted).toContain("2 / 3")
      const resolved = "---\nn: 2\n---\n"
      await fire(a, docA, conflicted, itemFrontier(docA), resolved)
      expect(renderItem(docA)).toBe(resolved)
      sync(docA, docB)
      expect(renderItem(docB)).toBe(resolved)
      expect(await captureOnDevice(a, "item.md", docA, resolved, itemFrontier(docA), resolved)).toBeNull()
      expect(await captureOnDevice(b, "item.md", docB, resolved, itemFrontier(docB), resolved)).toBeNull()
      docA.free()
      docB.free()
    })
  })
})
