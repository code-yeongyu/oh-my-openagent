import { describe, expect, test } from "bun:test"
import { parse } from "yaml"

import { itemFrontier, renderForDisk, renderItem, splitItem } from "./index"
import { captureCurrent, captureInto, newDoc } from "./test-support"

// Lead decision r6 (design (b)): the frontmatter is re-emitted from the merged typed model, but a
// file whose typed model is unchanged stays byte-for-byte, whatever its style. Only a real model
// change rewrites it canonically.

const STYLED = "---\n# a comment the model does not keep\nn:   2\ndescription: 'hello there'\ntags: [a, b]\n---\nbody\n"

describe("renderForDisk (lead decision r6)", () => {
  test("a file that differs from the canonical render only in style is returned byte-for-byte", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], STYLED)
    expect(renderItem(doc)).not.toBe(STYLED)
    expect(renderForDisk(doc, STYLED)).toBe(STYLED)
    doc.free()
  })

  test("a model change on a file whose frontmatter does not parse rewrites it canonically", async () => {
    const a = await newDoc("1")
    captureInto(a, "", [], STYLED)
    const b = await newDoc("2")
    b.import(a.export({ mode: "update" }))
    captureInto(b, renderItem(b) ?? "", itemFrontier(b), (renderItem(b) ?? "").replace("n: 2", "n: 3"))
    a.import(b.export({ mode: "update" }))
    const broken = "---\nn: [unclosed\n---\nbody\n"
    expect(renderForDisk(a, broken)).toBe(renderItem(a))
    expect(renderForDisk(a, broken)).toContain("n: 3")
    a.free()
    b.free()
  })

  test("a comment and quoting on an untouched key survive a sync that changes a different key", async () => {
    const a = await newDoc("1")
    captureInto(a, "", [], STYLED)
    const b = await newDoc("2")
    b.import(a.export({ mode: "update" }))
    captureInto(b, renderItem(b) ?? "", itemFrontier(b), (renderItem(b) ?? "").replace("n: 2", "n: 3"))
    a.import(b.export({ mode: "update" }))
    const written = renderForDisk(a, STYLED) ?? ""
    expect(written).toContain("# a comment the model does not keep")
    expect(written).toContain("description: 'hello there'")
    expect(written).toContain("n: 3")
    expect(written).toContain("tags: [a, b]")
    a.free()
    b.free()
  })

  test("comments on the changed key are handled deterministically: the line above is kept, the old value's inline comment goes", async () => {
    const disk = "---\n# about n\nn: 2 # old value note\nkeep: 'x' # untouched note\n---\nbody\n"
    const a = await newDoc("1")
    captureInto(a, "", [], disk)
    const b = await newDoc("2")
    b.import(a.export({ mode: "update" }))
    captureInto(b, renderItem(b) ?? "", itemFrontier(b), (renderItem(b) ?? "").replace("n: 2", "n: 3"))
    a.import(b.export({ mode: "update" }))
    const written = renderForDisk(a, disk) ?? ""
    expect(written).toBe("---\n# about n\nn: 3\nkeep: 'x' # untouched note\n---\nbody\n")
    expect(renderForDisk(a, disk)).toBe(written)
    a.free()
    b.free()
  })

  test("a body-only difference rewrites only the body and keeps the frontmatter bytes", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], STYLED)
    const stale = STYLED.replace("body\n", "old body\n")
    expect(renderForDisk(doc, stale)).toBe(STYLED)
    doc.free()
  })
})

function headerOf(text: string): unknown {
  return parse(text.split("---\n")[1] ?? "")
}

function styleOf(text: string): "crlf" | "lf" | "mixed" {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return crlf > 0 && lf > 0 ? "mixed" : crlf > 0 ? "crlf" : "lf"
}

async function syncedEdit(disk: string, edit: (rendered: string) => string) {
  const a = await newDoc("1")
  captureInto(a, "", [], disk)
  const b = await newDoc("2")
  b.import(a.export({ mode: "update" }))
  captureInto(b, renderItem(b) ?? "", itemFrontier(b), edit(renderItem(b) ?? ""))
  a.import(b.export({ mode: "update" }))
  b.free()
  return a
}

describe("renderForDisk with YAML anchors and aliases (delta review 0bde9bc01e HIGH, lead)", () => {
  const ANCHORED = "---\nbase: &x hello\n# about other\nother: *x # alias note\nn: 2 # keep\n---\nbody\n"

  test("changing the key that holds an anchor inlines the resolved value at its aliases", async () => {
    const a = await syncedEdit(ANCHORED, (r) => r.replace("base: hello", "base: bye"))
    expect(renderForDisk(a, ANCHORED)).toBe("---\nbase: bye\n# about other\nother: hello\nn: 2 # keep\n---\nbody\n")
    a.free()
  })

  test("deleting the key that holds an anchor inlines the resolved value at its aliases", async () => {
    const a = await syncedEdit(ANCHORED, (r) => r.replace("base: hello\n", ""))
    expect(renderForDisk(a, ANCHORED)).toBe("---\n# about other\nother: hello\nn: 2 # keep\n---\nbody\n")
    a.free()
  })

  test("changing a key that uses an alias rewrites only that key; the anchor stays", async () => {
    const a = await syncedEdit(ANCHORED, (r) => r.replace("other: hello", "other: own"))
    expect(renderForDisk(a, ANCHORED)).toBe("---\nbase: &x hello\n# about other\nother: own\nn: 2 # keep\n---\nbody\n")
    a.free()
  })

  test("changing the anchor of a merge key inlines the merged map", async () => {
    const merged = "---\nd: &m { a: 1 }\ne: { <<: *m, b: 2 } # merged\nz: 9 # keep\n---\nbody\n"
    const a = await syncedEdit(merged, (r) => r.replace("d: { a: 1 }", "d: { a: 5 }"))
    const written = renderForDisk(a, merged) ?? ""
    expect(written).not.toContain("*m")
    expect(written).toContain("z: 9 # keep")
    expect(written.split("---\n")[1]).toBe(renderItem(a)?.split("---\n")[1]?.replace("z: 9", "z: 9 # keep") ?? "")
    a.free()
  })

  test("an untouched anchor and alias survive a patch of another key", async () => {
    const a = await syncedEdit(ANCHORED, (r) => r.replace("n: 2", "n: 3"))
    expect(renderForDisk(a, ANCHORED)).toBe("---\nbase: &x hello\n# about other\nother: *x # alias note\nn: 3\n---\nbody\n")
    a.free()
  })

  test("a top-level merge key falls back to the canonical render", async () => {
    const top = "---\nd: &m { a: 1 }\n<<: *m\nn: 2\n---\nbody\n"
    const a = await syncedEdit(top, (r) => r.replace("n: 2", "n: 3"))
    expect(renderForDisk(a, top)).toBe(renderItem(a))
    a.free()
  })

  test("any failure inside the patch path falls back to the canonical render", async () => {
    const a = await syncedEdit(ANCHORED, (r) => r.replace("n: 2", "n: 3"))
    const failing = () => {
      throw new Error("patch failed")
    }
    expect(renderForDisk(a, ANCHORED, failing)).toBe(renderItem(a))
    a.free()
  })
})

describe("renderForDisk keeps untouched source exactly (delta review 0bde9bc01e LOW)", () => {
  const DISK = "---\nd: >\n  long folded\n  text here\nn: 2\nflow: {a: 1,   b: 2}\n# trailing comment\n---\nbody\n"

  test("a folded value, flow spacing and a trailing comment keep their bytes when another key changes", async () => {
    const a = await syncedEdit(DISK, (r) => r.replace("n: 2", "n: 3"))
    expect(renderForDisk(a, DISK)).toBe(DISK.replace("n: 2", "n: 3"))
    a.free()
  })

  test("a deleted key takes the comment lines directly above it; other bytes stay", async () => {
    const disk = "---\nkeep: 1\n# about gone\ngone: x # inline\nlast: 2\n---\nbody\n"
    const a = await syncedEdit(disk, (r) => r.replace("gone: x\n", ""))
    expect(renderForDisk(a, disk)).toBe("---\nkeep: 1\nlast: 2\n---\nbody\n")
    a.free()
  })

  test("a new key is added after the last key, before a trailing comment", async () => {
    const a = await syncedEdit(DISK, (r) => r.replace("n: 2", "n: 2\nadded: yes-new"))
    expect(renderForDisk(a, DISK)).toBe(DISK.replace("flow: {a: 1,   b: 2}\n", "flow: {a: 1,   b: 2}\nadded: yes-new\n"))
    a.free()
  })
})

describe("renderForDisk keeps the file's own line-ending style on every written line (delta review ea00e988be L1, lead)", () => {
  const LF = "---\nn: 2\nk: x # note\nbase: &a v\nother: *a\nz: 1\n---\nbody line\nsecond\n"
  const EDITS: Record<string, (rendered: string) => string> = {
    "change a key": (r) => r.replace("n: 2", "n: 3"),
    "add a key": (r) => r.replace("z: 1", "z: 1\nadded: new"),
    "delete a key": (r) => r.replace("k: x\n", ""),
    "delete the last key": (r) => r.replace("z: 1\n", ""),
    "anchor rewrite": (r) => r.replace("base: v", "base: w"),
  }


  test("the fences are written in the file's style on the splice path and on the canonical path (a key added to a file without frontmatter)", async () => {
    const spliced = LF.replaceAll("\n", "\r\n")
    const noFrontmatter = "body line\r\nsecond\r\n"
    const cases: [string, (rendered: string) => string][] = [
      [spliced, (r) => r.replace("n: 2", "n: 3")],
      [noFrontmatter, (r) => `---\nn: 3\n---\n${r}`],
    ]
    for (const [disk, edit] of cases) {
      const a = await syncedEdit(disk, edit)
      const written = renderForDisk(a, disk) ?? ""
      expect(splitItem(written).fm, `fences parse as fences: ${JSON.stringify(written)}`).not.toBeNull()
      expect(headerOf(written.replaceAll("\r\n", "\n"))).toMatchObject({ n: 3 })
      expect(written.startsWith("---\r\n"), JSON.stringify(written)).toBe(true)
      expect(written, JSON.stringify(written)).toContain("\r\n---\r\n")
      expect(styleOf(written), JSON.stringify(written)).toBe("crlf")
      a.free()
    }
  })

  for (const [style, disk] of [["lf", LF], ["crlf", LF.replaceAll("\n", "\r\n")]] as const) {
    for (const [name, edit] of Object.entries(EDITS)) {
      test(`${style} file, ${name}: one line-ending style equal to the input's, re-capture is a no-op`, async () => {
        const a = await syncedEdit(disk, edit)
        const written = renderForDisk(a, disk) ?? ""
        expect(styleOf(written), JSON.stringify(written)).toBe(style)
        expect(headerOf(written.replaceAll("\r\n", "\n"))).toEqual(headerOf(renderItem(a) ?? ""))
        expect(captureCurrent(a, written), JSON.stringify(written)).toBeNull()
        a.free()
      })
    }
  }
})

describe("renderForDisk keeps a leading UTF-8 BOM (t05 r7 probe, lead)", () => {
  const BASE = "---\nn: 2\nk: x\nz: 1\n---\nbody line\nsecond\n"
  const EDITS: Record<string, (rendered: string) => string> = {
    "change a key": (r) => r.replace("n: 2", "n: 3"),
    "add a key": (r) => r.replace("z: 1", "z: 1\nadded: new"),
    "delete a key": (r) => r.replace("k: x\n", ""),
  }

  test("capturing a BOM file types its frontmatter", () => {
    expect(splitItem("\ufeff---\nn: 2\n---\nbody\n").fm).not.toBeNull()
  })

  for (const [style, eol] of [["lf", "\n"], ["crlf", "\r\n"]] as const) {
    const disk = `\ufeff${BASE.replaceAll("\n", eol)}`
    for (const [name, edit] of Object.entries(EDITS)) {
      test(`bom + ${style} file, ${name}: the BOM and the file's line endings are kept, re-capture is a no-op`, async () => {
        const a = await syncedEdit(disk, edit)
        const written = renderForDisk(a, disk) ?? ""
        expect(written.startsWith(`\ufeff---${eol}`), JSON.stringify(written)).toBe(true)
        expect(written.slice(1).startsWith("\ufeff")).toBe(false)
        expect(styleOf(written), JSON.stringify(written)).toBe(style)
        expect(splitItem(written).fm, JSON.stringify(written)).not.toBeNull()
        expect(headerOf(written.slice(1).replaceAll("\r\n", "\n"))).toEqual(headerOf(renderItem(a) ?? ""))
        expect(captureCurrent(a, written), JSON.stringify(written)).toBeNull()
        a.free()
      })
    }
  }
})

describe("renderForDisk writes exactly one BOM for files without valid frontmatter (review d58391c9b3 HIGH 1)", () => {
  function oneLeadingBom(text: string): boolean {
    return text.startsWith("\ufeff") && text.split("\ufeff").length === 2
  }

  const CASES: [string, string, (rendered: string) => string][] = [
    ["a BOM file with no frontmatter", "\ufeffbody\r\n", (r) => `${r}x\r\n`],
    ["a BOM file with unparseable frontmatter", "\ufeff---\r\nn: [\r\n---\r\nbody\r\n", (r) => r.replace("body", "body2")],
    ["a key added to a BOM file with no frontmatter", "\ufeffbody\r\n", (r) => `---\r\nadded: y\r\n---\r\n${r.replace(/^\ufeff/, "")}`],
  ]

  for (const [name, disk, edit] of CASES) {
    test(`${name}, edited on one device and written by the other: one BOM, a second write and a recapture are no-ops`, async () => {
      const a = await syncedEdit(disk, edit)
      const written = renderForDisk(a, disk) ?? ""
      expect(oneLeadingBom(written), JSON.stringify(written)).toBe(true)
      expect(renderForDisk(a, written), JSON.stringify(written)).toBe(written)
      expect(captureCurrent(a, written), JSON.stringify(written)).toBeNull()
      a.free()
    })
  }
})

describe("renderForDisk written twice stays byte-stable (review d58391c9b3 MEDIUM 4)", () => {
  const BASE = "---\nn: 2\nk: x\nz: 1\n---\nbody line\nsecond\n"
  const EDITS: Record<string, (rendered: string) => string> = {
    "change a key": (r) => r.replace("n: 2", "n: 3"),
    "add a key": (r) => r.replace("z: 1", "z: 1\nadded: new"),
    "delete a key": (r) => r.replace("k: x\n", ""),
  }
  const STYLES: [string, string][] = [
    ["lf", BASE],
    ["crlf", BASE.replaceAll("\n", "\r\n")],
    ["bom + lf", `\ufeff${BASE}`],
    ["bom + crlf", `\ufeff${BASE.replaceAll("\n", "\r\n")}`],
  ]

  for (const [style, disk] of STYLES) {
    for (const [name, edit] of Object.entries(EDITS)) {
      test(`${style} file, ${name}: renderForDisk(renderForDisk(x)) equals renderForDisk(x)`, async () => {
        const a = await syncedEdit(disk, edit)
        const once = renderForDisk(a, disk) ?? ""
        expect(renderForDisk(a, once), JSON.stringify(once)).toBe(once)
        a.free()
      })
    }
  }
})
