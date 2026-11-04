import { describe, expect, test } from "bun:test"

import { DOC_SOURCES } from "./docs-content.generated"
import { DOC_PAGES_DATA, DOC_SECTIONS_DATA } from "./docs-sections-data.mjs"

// Every docs route, as the HTML it puts on one page plus the ids its React shell adds around that HTML:
// /docs wraps each doc in a <section id={section.id}>; the standalone pages add none.
const PAGES = [
  {
    route: "/docs",
    shellIds: DOC_SECTIONS_DATA.map((section) => section.id),
    html: DOC_SECTIONS_DATA.map((section) => DOC_SOURCES[section.file] ?? "").join("\n"),
  },
  ...DOC_PAGES_DATA.map((page) => ({
    route: page.route,
    shellIds: [],
    html: DOC_SOURCES[page.file] ?? "",
  })),
]

function attributeValues(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((match) => match[1] ?? "")
}

describe("docs in-page anchors", () => {
  for (const page of PAGES) {
    test(`${page.route}: every #fragment link lands on an element, and ids are unique`, () => {
      const ids = [...page.shellIds, ...attributeValues(page.html, /\sid="([^"]*)"/g)]
      const known = new Set(ids)
      const fragments = attributeValues(page.html, /\shref="#([^"]*)"/g)

      expect({ route: page.route, unresolved: fragments.filter((id) => !known.has(id)) }).toEqual({
        route: page.route,
        unresolved: [],
      })
      expect({
        route: page.route,
        duplicated: ids.filter((id, i) => ids.indexOf(id) !== i),
      }).toEqual({
        route: page.route,
        duplicated: [],
      })
    })
  }
})
