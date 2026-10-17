import { describe, expect, test } from "bun:test"
import { parse as parseYaml } from "yaml"

import { itemFrontier, renderItem, splitItem } from "./index"
import { captureCurrent, captureInto, newDoc } from "./test-support"

// Spec #454 (lead decisions for r6): a register with several values renders as ONE
// double-quoted YAML string whose components are each value's canonical source, deduplicated,
// sorted by UTF-8 bytes, joined with " / "; a single value renders its canonical source
// verbatim. YAML aliases and merge keys resolve before a value is classified; a custom tag makes
// the frontmatter invalid, so the whole file stays body.

const LONG = "This is a fairly long description line that runs well past the default eighty column fold width of yaml"
const HOSTILE = [LONG, "한국어 설명 문장이 길게 이어집니다. ".repeat(20).trim(), "a\nb", "a\r\nb", "\tlead tab", " lead", "trail ", "x # y", "k: v", "|-", ">", "a\n", "#start", "- dash", "a\n---\nb"]

function headerOf(rendered: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(rendered.slice(4, rendered.indexOf("\n---\n", 3)))
  return typeof parsed === "object" && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {}
}

async function concurrent(seed: string, left: string, right: string): Promise<string> {
  const a = await newDoc("1")
  captureInto(a, "", [], seed)
  const b = await newDoc("2")
  b.import(a.export({ mode: "update" }))
  captureInto(a, seed, itemFrontier(a), left)
  captureInto(b, seed, itemFrontier(b), right)
  a.import(b.export({ mode: "update" }))
  b.import(a.export({ mode: "update" }))
  const rendered = renderItem(a) ?? ""
  expect(renderItem(b)).toBe(rendered)
  expect(captureCurrent(a, rendered), `re-capture is not a no-op: ${JSON.stringify(rendered)}`).toBeNull()
  a.free()
  b.free()
  return rendered
}

describe("register render (spec #454)", () => {
  test("several values render as one double-quoted string of canonical sources", async () => {
    const rendered = await concurrent("---\nn: 1\n---\n", "---\nn: 2\n---\n", "---\nn: 3\n---\n")
    expect(rendered).toBe('---\nn: "2 / 3"\n---\n')
  })

  test("a string and a number with the same text stay two values, sorted by UTF-8 bytes", async () => {
    const rendered = await concurrent("---\nn: 1\n---\n", "---\nn: 3\n---\n", "---\nn: \"3\"\n---\n")
    expect(parseYaml(rendered.slice(4, rendered.indexOf("\n---", 4)))).toEqual({ n: '"3" / 3' })
  })

  test("hostile string values are byte-stable over 5 capture -> render -> capture cycles (t05 report)", async () => {
    for (const value of HOSTILE) {
      const doc = await newDoc("1")
      captureInto(doc, "", [], `---\nk: ${JSON.stringify(value)}\n---\nx\n`)
      const first = renderItem(doc) ?? ""
      for (let cycle = 0; cycle < 5; cycle++) {
        const rendered = renderItem(doc) ?? ""
        expect(rendered, `${JSON.stringify(value)} cycle ${cycle} changed bytes`).toBe(first)
        expect(headerOf(rendered), `${JSON.stringify(value)} cycle ${cycle}`).toEqual({ k: value })
        expect(captureCurrent(doc, rendered), `${JSON.stringify(value)} cycle ${cycle} re-capture minted ops`).toBeNull()
      }
      doc.free()
    }
  })

  test("a multi-value register with multiline components renders one valid string of whole canonical sources", async () => {
    const rendered = await concurrent("---\nk: s\n---\n", '---\nk: "a\\nb"\n---\n', '---\nk: "|-"\n---\n')
    const joined = headerOf(rendered).k
    expect(typeof joined).toBe("string")
    const parts = String(joined).split(" / ").map((part) => parseYaml(part))
    expect(parts.sort()).toEqual(["a\nb", "|-"])
  })

  test("a single value renders its canonical source verbatim", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], "---\nn: 2\nflag: true\nname: plain words\n---\n")
    expect(renderItem(doc)).toBe("---\nn: 2\nflag: true\nname: plain words\n---\n")
    doc.free()
  })
})

describe("source forms round-trip through the whole-frontmatter emitter (review r6 C1, lead)", () => {
  const FORMS = [
    `---\ndescription: ${"word ".repeat(40).trim()}\n---\nbody\n`,
    "---\nk: |\n  line one\n  line two\n---\n",
    "---\nk: >\n  folded line\n  continues here\n---\n",
    "---\nk: |-\n  kept\n\n  blank above\n---\n",
    "---\nk: \"x: y # not a comment\"\n---\n",
    "---\nk: 'it''s: #x'\n---\n",
  ]

  test("parse(render(x)) equals parse(x) and the render is byte-stable over 5 cycles", async () => {
    for (const form of FORMS) {
      const doc = await newDoc("1")
      captureInto(doc, "", [], form)
      const first = renderItem(doc) ?? ""
      expect(headerOf(first), `form ${JSON.stringify(form)}`).toEqual(headerOf(form))
      for (let cycle = 0; cycle < 5; cycle++) {
        expect(captureCurrent(doc, renderItem(doc) ?? ""), `form ${JSON.stringify(form)} cycle ${cycle}`).toBeNull()
        expect(renderItem(doc), `form ${JSON.stringify(form)} cycle ${cycle} changed bytes`).toBe(first)
      }
      doc.free()
    }
  })
})

describe("Unicode spaces YAML does not trim are part of the value (delta review 0bde9bc01e LOW)", () => {
  const SPACES = ["\u00a0", "\ufeff", "\u3000", "\u2003", "\u2009", "\u200b", "\u2028", "\u0085", "\u1680", "\u202f"]

  test("a value starting or ending with one keeps it through capture -> render -> capture", async () => {
    for (const space of SPACES) {
      for (const value of [`${space}v`, `v${space}`, `${space}v${space}`]) {
        const doc = await newDoc("1")
        captureInto(doc, "", [], `---\nk: ${JSON.stringify(value)}\n---\n`)
        const first = renderItem(doc) ?? ""
        expect(headerOf(first).k, `value ${JSON.stringify(value)}`).toBe(value)
        expect(captureCurrent(doc, first), `value ${JSON.stringify(value)} re-capture`).toBeNull()
        expect(renderItem(doc), `value ${JSON.stringify(value)} stable`).toBe(first)
        doc.free()
      }
    }
  })
})

describe("CRLF frontmatter capture (delta review ea00e988be)", () => {
  test("the last frontmatter line's CR is a line ending, not part of the value", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], "---\nn: 2\r\nz: 1\r\n---\nbody\n")
    expect(headerOf(renderItem(doc) ?? "")).toEqual({ n: 2, z: 1 })
    doc.free()
  })
})

describe("register values keep their YAML type (review r6 M1, M2)", () => {
  test("a register value joined into a set-kind key keeps its type as an element", async () => {
    for (const [source, expected] of [["3", 3], ["true", true], ["{ a: 1 }", { a: 1 }]] as const) {
      // Concurrent first writes tie on Lamport; the lower peer (the list writer) fixes the kind as set.
      const rendered = await concurrent("---\nother: 1\n---\n", "---\nother: 1\nk:\n  - x\n---\n", `---\nother: 1\nk: ${source}\n---\n`)
      expect(headerOf(rendered).k, `register ${source} inside a set`).toEqual(["x", expected])
    }
  })

  test("retyping 3 as '3' writes the string value instead of being dropped", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], "---\nn: 3\n---\n")
    captureInto(doc, "---\nn: 3\n---\n", itemFrontier(doc), "---\nn: '3'\n---\n")
    expect(headerOf(renderItem(doc) ?? "")).toEqual({ n: "3" })
    expect(captureCurrent(doc, renderItem(doc) ?? "")).toBeNull()
    doc.free()
  })
})

describe("YAML resolution before classification (spec #454)", () => {
  test("an alias and a merge key classify by their resolved values", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], "---\nbase: &b hello\ncopy: *b\ndefaults: &d { x: 1 }\nitem:\n  <<: *d\n  y: 2\n---\n")
    const fields = new Map((splitItem(renderItem(doc) ?? "").fm ?? []).map((e) => [e.key, e.value]))
    expect(fields.get("copy")).toEqual({ kind: "reg", value: "hello" })
    expect(fields.get("item")).toEqual({ kind: "reg", value: "{ x: 1, y: 2 }" })
    doc.free()
  })

  test("a custom tag makes the frontmatter invalid: the whole file stays body, byte-exact", async () => {
    const text = "---\ndescription: d\nkind: !custom thing\n---\nbody\n"
    expect(splitItem(text).fm).toBeNull()
    const doc = await newDoc("1")
    captureInto(doc, "", [], text)
    expect(renderItem(doc)).toBe(text)
    doc.free()
  })
})
