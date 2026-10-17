import { describe, expect, test } from "bun:test"

import {
  createManifestDoc,
  manifestAbsorbedInto,
  manifestAddBinding,
  manifestBindings,
  manifestDisplayName,
  manifestExport,
  manifestHasBinding,
  manifestMarkAbsorbed,
  manifestSetDisplayName,
} from "./index"

describe("space manifest (sync-design §3)", () => {
  test("binding keys form an add-wins set", async () => {
    const doc = await createManifestDoc("1")
    manifestAddBinding(doc, "repo:github.com/a/b")
    manifestAddBinding(doc, "repo:github.com/a/b")
    manifestAddBinding(doc, "named:Dori")
    expect(manifestBindings(doc)).toEqual(["named:Dori", "repo:github.com/a/b"])
    expect(manifestHasBinding(doc, "named:Dori")).toBe(true)
    expect(manifestHasBinding(doc, "repo:github.com/a/c")).toBe(false)
    doc.free()
  })

  test("holds a display name", async () => {
    const doc = await createManifestDoc("1")
    expect(manifestDisplayName(doc)).toBeNull()
    manifestSetDisplayName(doc, "sisyphuslabs")
    expect(manifestDisplayName(doc)).toBe("sisyphuslabs")
    manifestSetDisplayName(doc, "sisyphus labs")
    expect(manifestDisplayName(doc)).toBe("sisyphus labs")
    doc.free()
  })

  test("the absorbed_into tombstone sticks to its first value", async () => {
    const doc = await createManifestDoc("1")
    expect(manifestAbsorbedInto(doc)).toBeNull()
    manifestMarkAbsorbed(doc, "aaaa")
    expect(manifestAbsorbedInto(doc)).toBe("aaaa")
    manifestMarkAbsorbed(doc, "bbbb")
    expect(manifestAbsorbedInto(doc)).toBe("aaaa")
    doc.free()
  })

  test("export/import round-trips the whole manifest", async () => {
    const a = await createManifestDoc("1")
    manifestAddBinding(a, "repo:github.com/a/b")
    manifestAddBinding(a, "named:Dori")
    manifestSetDisplayName(a, "alpha")
    manifestMarkAbsorbed(a, "0123456789abcdef0123456789abcdef")
    const b = await createManifestDoc("2")
    b.import(manifestExport(a))
    expect(manifestBindings(b)).toEqual(manifestBindings(a))
    expect(manifestDisplayName(b)).toBe("alpha")
    expect(manifestAbsorbedInto(b)).toBe("0123456789abcdef0123456789abcdef")
    a.free()
    b.free()
  })

  test("two devices' manifests converge to the union of binding keys", async () => {
    const a = await createManifestDoc("1")
    manifestAddBinding(a, "repo:github.com/a/b")
    const b = await createManifestDoc("2")
    manifestAddBinding(b, "named:Dori")
    a.import(manifestExport(b))
    b.import(manifestExport(a))
    expect(manifestBindings(a)).toEqual(["named:Dori", "repo:github.com/a/b"])
    expect(manifestBindings(b)).toEqual(["named:Dori", "repo:github.com/a/b"])
    a.free()
    b.free()
  })

  test("concurrent display-name writes converge to one value", async () => {
    const a = await createManifestDoc("1")
    const b = await createManifestDoc("2")
    manifestSetDisplayName(a, "alpha")
    manifestSetDisplayName(b, "beta")
    a.import(manifestExport(b))
    b.import(manifestExport(a))
    expect(manifestDisplayName(a)).not.toBeNull()
    expect(manifestDisplayName(a)).toBe(manifestDisplayName(b))
    a.free()
    b.free()
  })
})
