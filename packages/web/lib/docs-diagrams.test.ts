import { readdirSync } from "node:fs"

import { describe, expect, test } from "bun:test"

import { DOC_SOURCES } from "./docs-content.generated"
import { DIAGRAMS_DIR, diagramKey, docsMermaidSources } from "./docs-diagrams.mjs"

describe("docs Mermaid diagrams", () => {
  test("no doc ships a Mermaid block as raw source", () => {
    for (const [file, html] of Object.entries(DOC_SOURCES)) {
      expect({ file, raw: html.includes("language-mermaid") }).toEqual({ file, raw: false })
    }
  })

  test("every Mermaid block is an inline SVG figure, with no script", async () => {
    const blocks = await docsMermaidSources()
    expect(blocks.length).toBeGreaterThan(0)

    for (const file of new Set(blocks.map((block) => block.file))) {
      const html = DOC_SOURCES[file] ?? ""
      const figures =
        html.match(/<figure class="docs-diagram">\s*<svg[\s\S]*?<\/svg>\s*<\/figure>/g) ?? []

      expect({ file, figures: figures.length }).toEqual({
        file,
        figures: blocks.filter((block) => block.file === file).length,
      })
      for (const figure of figures) {
        expect(figure).not.toContain("<script")
        expect(figure).not.toContain("foreignObject")
        expect(figure).toMatch(/viewBox="[\d.\s-]+"/)
      }
    }
  })

  test("the committed SVGs are exactly the ones the docs need", async () => {
    const needed = (await docsMermaidSources()).map(({ source }) => `${diagramKey(source)}.svg`)
    const committed = readdirSync(new URL(`../${DIAGRAMS_DIR}/`, import.meta.url)).filter((name) =>
      name.endsWith(".svg"),
    )

    expect(committed.sort()).toEqual([...new Set(needed)].sort())
  })
})
