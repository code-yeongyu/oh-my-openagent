import { describe, expect, test } from "bun:test"

import { renderEntry, splitItem } from "./frontmatter"
import { itemFrontier, renderItem } from "./index"
import { captureInto, newDoc } from "./test-support"

// Windows-edited memory files arrive with CRLF endings; the split grammar must recognise
// them exactly like LF, while rendering stays canonical LF.

describe("splitItem on CRLF files", () => {
  test("a CRLF file's `title: A` parses as a key", () => {
    const parsed = splitItem("---\r\ntitle: A\r\n---\r\nbody\r\n")
    expect(parsed.fm?.map((entry) => [entry.key, entry.value])).toEqual([
      ["title", { kind: "reg", value: "A" }],
    ])
    expect(parsed.body).toBe("body\r\n")
  })

  test("CRLF headers parse every key and kind; LF behaviour is unchanged", () => {
    const crlf = splitItem("---\r\ntitle: A\r\ntags:\r\n  - x\r\n  - y\r\nreviewed: true\r\n---\r\nbody\r\n")
    expect(crlf.fm?.map((entry) => entry.key)).toEqual(["title", "tags", "reviewed"])
    expect(crlf.fm?.[1]?.value).toEqual({ kind: "set", elements: ["x", "y"], flow: "[ x, y ]" })
    expect(crlf.fm?.[2]?.value).toEqual({ kind: "reg", value: "true" })
    const lf = splitItem("---\ntitle: A\n---\nbody\n")
    expect(lf.fm?.map((entry) => entry.key)).toEqual(["title"])
    expect(lf.body).toBe("body\n")
  })

  test("a CRLF frontmatter value round-trips through the canonical render", () => {
    const parsed = splitItem("---\r\ntitle: 茶 log\r\ntags: [a, b]\r\n---\r\nbody\r\n")
    const lines = (parsed.fm ?? []).map(({ key, value }) =>
      renderEntry(key, value.kind === "set" ? value.elements : value.kind === "reg" ? value.value : "", value.kind === "reg"),
    )
    const again = splitItem(`---\n${lines.join("\n")}\n---\nbody\n`)
    expect(again.fm?.map((entry) => entry.key)).toEqual(["title", "tags"])
    expect(again.fm?.[0]?.value).toEqual({ kind: "reg", value: "茶 log" })
    expect(again.fm?.[1]?.value).toEqual({ kind: "set", elements: ["a", "b"], flow: "[ a, b ]" })
  })

  test("capture of a CRLF file keeps the key as frontmatter", async () => {
    const doc = await newDoc("1")
    try {
      captureInto(doc, "", [], "---\r\ntitle: A\r\n---\r\nbody\r\n")
      const rendered = renderItem(doc)
      expect(splitItem(rendered ?? "").fm?.[0]?.key).toBe("title")
      expect(rendered).toContain("body")
      expect(captureInto(doc, rendered ?? "", itemFrontier(doc), rendered ?? "")).toBeNull()
    } finally {
      doc.free()
    }
  })
})
