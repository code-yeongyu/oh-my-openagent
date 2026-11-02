import { describe, expect, test } from "bun:test"

import { DOC_SOURCES } from "./docs-content.generated"
import { headingId, splitDocPage, splitDocSections } from "./docs-page"
import { DOC_GUIDE_PAGES } from "./docs-sections"

describe("splitDocPage", () => {
  test("cuts the widget block out of the install guide and splits the rest by h2", () => {
    const page = splitDocPage(DOC_SOURCES["guide/install.md"] ?? "")

    expect(page.lead).toContain("<h1>")
    expect(page.lead).not.toContain("get.omo.dev/install.sh")
    expect(page.afterWidget).not.toContain("<h2>")
    expect(page.sections.map((section) => section.id)).toContain("fix-your-path")
    for (const section of page.sections) expect(section.html.startsWith("<h2>")).toBe(true)
  })

  test("fails the build when the markers are missing", () => {
    expect(() => splitDocPage("<h1>Install</h1><h2>Update</h2>")).toThrow(/install-tabs markers/)
  })
})

describe("splitDocSections", () => {
  for (const guide of DOC_GUIDE_PAGES) {
    test(`splits ${guide.file} into a titled lead and unique h2 sections`, () => {
      const page = splitDocSections(DOC_SOURCES[guide.file] ?? "")

      expect(page.lead).toContain(`<h1>${guide.title}</h1>`)
      expect(page.lead).not.toContain("<h2>")
      expect(page.sections.length).toBeGreaterThan(0)
      const ids = page.sections.map((section) => section.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const section of page.sections) expect(section.html.startsWith("<h2>")).toBe(true)
    })
  }

  test("links between guide pages resolve to their site routes", () => {
    expect(DOC_SOURCES["guide/agents.md"]).toContain('href="/docs/workflows"')
    expect(DOC_SOURCES["guide/workflows.md"]).toContain('href="/docs/keywords"')
  })
})

describe("headingId", () => {
  test("matches GitHub's anchors, so in-page links work on both", () => {
    expect(headingId("Fix your PATH")).toBe("fix-your-path")
    expect(headingId("Install with npm or Bun instead")).toBe("install-with-npm-or-bun-instead")
    expect(headingId("Behind a proxy, or offline?")).toBe("behind-a-proxy-or-offline")
  })
})
