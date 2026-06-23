/// <reference types="bun-types" />

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { buildFilename, writeInboxDraft } from "./inbox-writer"
import type { CartographerDraft } from "./types"

function baseDraft(overrides: Partial<CartographerDraft> = {}): CartographerDraft {
  return {
    title: "Test zettel title",
    summary: "Brief summary",
    principio_guida: "Principle",
    body_markdown: "Body content here.",
    tags: ["test"],
    moc: "MOC - Discoveries",
    status: "seed",
    related: [],
    ...overrides,
  }
}

describe("buildFilename", () => {
  test("#given auto origin and timestamp 2026-04-19T20:00:00Z #when called #then formats correctly", () => {
    const name = buildFilename("2026-04-19T20:00:00Z", "auto-draft", "Some Title")
    expect(name).toBe("2026-04-19 20.00 - [auto] Some Title.md")
  })

  test("#given manual origin #when called #then uses [manual] tag", () => {
    const name = buildFilename("2026-04-19T20:00:00Z", "manual-draft", "Another")
    expect(name).toContain("[manual]")
  })

  test("#given illegal filename chars in title #when called #then they are sanitized", () => {
    const name = buildFilename("2026-04-19T20:00:00Z", "auto-draft", `bad/title: with "quote"`)
    expect(name).not.toContain("/")
    expect(name).not.toContain(":")
    expect(name).not.toContain("?")
    expect(name).not.toContain('"')
  })
})

describe("writeInboxDraft", () => {
  let vault: string

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "omo-meeting-vault-"))
  })

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true })
  })

  describe("#given a draft and vault", () => {
    test("#when written #then markdown file appears in 00_Inbox", async () => {
      const result = await writeInboxDraft(
        { vaultPath: vault },
        {
          draft: baseDraft(),
          source_memory_ids: ["m_1"],
          origin: "auto-draft",
          created_at_iso: "2026-04-19T20:00:00Z",
        },
      )

      expect(existsSync(result.path)).toBe(true)
      expect(result.path).toContain("00_Inbox")
      expect(result.path.endsWith(".md")).toBe(true)
      const contents = readFileSync(result.path, "utf8")
      expect(contents).toContain("Test zettel title")
      expect(contents).toContain("origin: auto-draft")
    })

    test("#when inboxSubdir is overridden #then draft lands there", async () => {
      const result = await writeInboxDraft(
        { vaultPath: vault, inboxSubdir: "custom_inbox" },
        {
          draft: baseDraft(),
          source_memory_ids: [],
          origin: "manual-draft",
        },
      )

      expect(result.path).toContain("custom_inbox")
      expect(existsSync(result.path)).toBe(true)
    })
  })
})
