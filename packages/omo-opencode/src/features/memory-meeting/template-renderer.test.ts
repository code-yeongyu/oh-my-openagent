/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { renderInboxZettel } from "./template-renderer"
import type { CartographerDraft } from "./types"

function draft(overrides: Partial<CartographerDraft> = {}): CartographerDraft {
  return {
    title: "Vertex access token auto-refresh on 401",
    summary: "Adapter self-heals on stale gcloud token by invalidating cache and retrying once.",
    principio_guida: "Cached credentials need a self-invalidation path tied to upstream rejection.",
    body_markdown: "## :LiAlertTriangle: Problema\n\nIl token era cacheato.\n\n## :LiCheckCircle: Soluzione\n\nAggiunto invalidateAndRefresh.",
    tags: ["vertex", "auth", "resilience"],
    moc: "MOC - Discoveries",
    status: "seed",
    related: ["[[Direct Vertex transport for curator]]"],
    ...overrides,
  }
}

describe("renderInboxZettel", () => {
  describe("#given a complete draft", () => {
    test("#when rendered #then frontmatter contains all required fields", () => {
      const md = renderInboxZettel({
        draft: draft(),
        source_memory_ids: ["m_abc", "m_def"],
        origin: "auto-draft",
        created_at_iso: "2026-04-19T20:00:00Z",
      })

      expect(md).toContain('title: "Vertex access token auto-refresh on 401"')
      expect(md).toContain("type: zettel")
      expect(md).toContain("status: seed")
      expect(md).toContain('moc: "[[MOC - Discoveries]]"')
      expect(md).toContain("  - vertex")
      expect(md).toContain("  - draft-auto")
      expect(md).toContain("created: 2026-04-19")
      expect(md).toContain("meeting_ready: false")
      expect(md).toContain("origin: auto-draft")
      expect(md).toContain('source_memory_ids: ["m_abc", "m_def"]')
    })

    test("#when rendered #then body contains Principio Guida callout and title h1", () => {
      const md = renderInboxZettel({
        draft: draft(),
        source_memory_ids: [],
        origin: "auto-draft",
        created_at_iso: "2026-04-19T20:00:00Z",
      })

      expect(md).toContain("# Vertex access token auto-refresh on 401")
      expect(md).toContain("> [!TIP] Principio Guida")
      expect(md).toContain("> Cached credentials need a self-invalidation path")
    })

    test("#when rendered #then body markdown is inlined", () => {
      const md = renderInboxZettel({
        draft: draft(),
        source_memory_ids: [],
        origin: "auto-draft",
      })
      expect(md).toContain(":LiAlertTriangle: Problema")
      expect(md).toContain(":LiCheckCircle: Soluzione")
    })
  })

  describe("#given related wikilinks without brackets", () => {
    test("#when rendered #then brackets are added", () => {
      const md = renderInboxZettel({
        draft: draft({ related: ["Some Bare Note Title"] }),
        source_memory_ids: [],
        origin: "manual-draft",
      })
      expect(md).toContain("[[Some Bare Note Title]]")
    })
  })

  describe("#given manual origin", () => {
    test("#when rendered #then draft-manual tag is set", () => {
      const md = renderInboxZettel({
        draft: draft(),
        source_memory_ids: [],
        origin: "manual-draft",
      })
      expect(md).toContain("  - draft-manual")
      expect(md).not.toContain("  - draft-auto")
    })
  })

  describe("#given a MOC wikilink", () => {
    test("#when rendered #then MOC appears twice: in frontmatter + once in Vedi Anche", () => {
      const md = renderInboxZettel({
        draft: draft(),
        source_memory_ids: [],
        origin: "auto-draft",
      })
      const mocMatches = md.match(/\[\[MOC - Discoveries\]\]/g) ?? []
      expect(mocMatches.length).toBe(2)
    })

    test("#when rendered with related wikilinks #then MOC is last entry in Vedi Anche list", () => {
      const md = renderInboxZettel({
        draft: draft({
          related: ["[[Other Note]]", "[[Another Note]]"],
        }),
        source_memory_ids: [],
        origin: "auto-draft",
      })
      const vediAncheMatch = md.match(/## :LiLink: Vedi Anche\n([\s\S]*?)(?=\n## |\n---|$)/)
      expect(vediAncheMatch).not.toBeNull()
      const section = vediAncheMatch?.[1] ?? ""
      const lines = section.trim().split("\n").filter((l) => l.startsWith("- "))
      expect(lines).toHaveLength(3)
      expect(lines[2]).toBe("- [[MOC - Discoveries]]")
    })
  })

  describe("#given source memory ids", () => {
    test("#when rendered #then Provenance section lists them", () => {
      const md = renderInboxZettel({
        draft: draft(),
        source_memory_ids: ["m_abc", "m_xyz"],
        origin: "auto-draft",
      })
      expect(md).toContain(":LiRefreshCw: Provenance")
      expect(md).toContain("`m_abc`")
      expect(md).toContain("`m_xyz`")
    })
  })

  describe("#given title with quotes", () => {
    test("#when rendered #then quotes are escaped in frontmatter", () => {
      const md = renderInboxZettel({
        draft: draft({ title: `Use "smart" caching strategy` }),
        source_memory_ids: [],
        origin: "auto-draft",
      })
      expect(md).toContain(`title: "Use \\"smart\\" caching strategy"`)
    })
  })
})
