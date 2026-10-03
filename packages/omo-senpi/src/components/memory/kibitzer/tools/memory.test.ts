import { describe, expect, test } from "bun:test"

import { MEMORY_EXPANSION_BOUNDS } from "./memory"
import { commitMemory, harness, jsonOf, memoryRepo, tempRoot, textOf, writeMemory } from "./test-support"

interface SearchHit {
  readonly path: string
  readonly description: string
  readonly excerpt: string
}

describe("memory tool (read-only)", () => {
  test("#given committed memories #when search runs #then only corpus-verified paths are returned and recorded for nudging", async () => {
    const root = await tempRoot()
    const repo = await memoryRepo()
    await commitMemory(repo, "notes/deploy.md", "Deploy with bun build before tagging a release.", "Release deploy steps")
    await commitMemory(repo, "notes/unrelated.md", "Coffee preferences.", "Coffee")
    await writeMemory(repo, "notes/uncommitted-deploy.md", "Deploy uncommitted draft.")
    const h = harness({ workspaceRoot: root, repo })

    const result = jsonOf(await h.call("memory", { operation: "search", query: "deploy" }))
    const hits = result.results as SearchHit[]
    expect(hits.map((hit) => hit.path)).toEqual(["notes/deploy.md"])
    expect(hits[0]?.description).toBe("Release deploy steps")
    expect(hits[0]?.excerpt).toContain("Deploy")
    expect([...h.searchedPaths]).toEqual(["notes/deploy.md"])
  })

  test("#given a search cap #when many memories match #then the result is bounded", async () => {
    const root = await tempRoot()
    const repo = await memoryRepo()
    for (let index = 0; index < 5; index += 1) await commitMemory(repo, `notes/n${index}.md`, `shared topic ${index}`)
    const h = harness({ workspaceRoot: root, repo, caps: { memorySearchResults: 2 } })

    const result = jsonOf(await h.call("memory", { operation: "search", query: "shared" }))
    expect(result.results).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  test("#given a committed memory #when read #then the committed body is returned redacted and capped", async () => {
    const root = await tempRoot()
    const repo = await memoryRepo()
    await commitMemory(repo, "notes/creds.md", `password=hunter2hunter2 ${"z".repeat(400)}`)
    await writeMemory(repo, "notes/creds.md", "working tree edit that is NOT committed")
    const h = harness({ workspaceRoot: root, repo, caps: { memoryReadChars: 200 } })

    const result = await h.call("memory", { operation: "read", path: "notes/creds.md" })
    expect(result.isError).toBeUndefined()
    const text = textOf(result)
    expect(text).not.toContain("hunter2hunter2")
    expect(text).not.toContain("working tree edit")
    expect(text).toContain("[truncated")
    expect(text.length).toBeLessThanOrEqual(200 + 128)
  })

  test("#given a searched path that was never offered #when nudged #then the nudge is accepted from the lifetime union", async () => {
    const root = await tempRoot()
    const repo = await memoryRepo()
    await commitMemory(repo, "notes/deploy.md", "Deploy with bun build before tagging.")
    const h = harness({ workspaceRoot: root, repo })

    const before = await h.call("nudge", { path: "notes/deploy.md", hint: "Deploy runs bun build before tagging." })
    expect(before.isError).toBe(true)
    await h.call("memory", { operation: "search", query: "deploy" })
    const after = await h.call("nudge", { path: "notes/deploy.md", hint: "Deploy runs bun build before tagging." })
    expect(after.isError).toBeUndefined()
    expect(h.accepted).toHaveLength(1)
  })

  test("#given a surfaced path #when nudged #then it is rejected even though it was offered", async () => {
    const root = await tempRoot()
    const repo = await memoryRepo()
    const h = harness({ workspaceRoot: root, repo })
    h.offered.add("notes/seen.md")
    h.surfaced.add("notes/seen.md")

    const result = await h.call("nudge", { path: "notes/seen.md", hint: "Already known fact." })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("already surfaced")
    expect(h.accepted).toHaveLength(0)
  })

  test("#given an unknown operation #when called #then a structured rejection names the allowed operations", async () => {
    const root = await tempRoot()
    const repo = await memoryRepo()
    const h = harness({ workspaceRoot: root, repo })

    const result = await h.call("memory", { operation: "create", path: "notes/new.md" })
    expect(result.isError).toBe(true)
    expect(jsonOf(result)).toMatchObject({ rejected: "unsupported_operation" })
  })
})

describe("memory tool search with query expansion", () => {
  const ADDED = ["synonyms", "keywords", "related", "note_line"]

  async function seeded() {
    const root = await tempRoot()
    const repo = await memoryRepo()
    await commitMemory(repo, "notes/revert.md", "Revert the release when the canary fails.", "Release safety")
    await commitMemory(repo, "notes/deploy.md", "Undo shipment steps for the lighthouse service.", "Shipment")
    await commitMemory(repo, "notes/coffee.md", "Coffee preferences.", "Coffee")
    return { root, repo }
  }

  test("#given the default settings #when the tool is built #then its schema has no added-term field and added terms change nothing", async () => {
    const { root, repo } = await seeded()
    const h = harness({ workspaceRoot: root, repo })

    const memory = h.tools.find((tool) => tool.name === "memory")
    for (const field of ADDED) expect(JSON.stringify(memory?.parameters)).not.toContain(`"${field}"`)
    const plain = jsonOf(await h.call("memory", { operation: "search", query: "undo shipment" }))
    const widened = jsonOf(await h.call("memory", { operation: "search", query: "undo shipment", synonyms: ["revert", "release"] }))
    expect((plain.results as SearchHit[]).map((hit) => hit.path)).toEqual(["notes/deploy.md"])
    expect(widened).toEqual(plain)
  })

  test("#given query expansion on #when a search adds synonyms #then the differently worded memory is found after the exact match and may be nudged", async () => {
    const { root, repo } = await seeded()
    const h = harness({ workspaceRoot: root, repo, queryExpansion: true })

    const memory = h.tools.find((tool) => tool.name === "memory")
    for (const field of ADDED) expect(JSON.stringify(memory?.parameters)).toContain(`"${field}"`)
    const result = jsonOf(await h.call("memory", { operation: "search", query: "undo shipment", synonyms: ["revert", "release"], note_line: "Roll the release back when the canary fails." }))
    expect((result.results as SearchHit[]).map((hit) => hit.path)).toEqual(["notes/deploy.md", "notes/revert.md"])
    expect([...h.searchedPaths].sort()).toEqual(["notes/deploy.md", "notes/revert.md"])
  })

  test("#given query expansion on #when a search adds nothing #then it returns what the default tool returns", async () => {
    const { root, repo } = await seeded()
    const off = harness({ workspaceRoot: root, repo })
    const on = harness({ workspaceRoot: root, repo, queryExpansion: true })

    const expected = jsonOf(await off.call("memory", { operation: "search", query: "undo shipment" }))
    expect(jsonOf(await on.call("memory", { operation: "search", query: "undo shipment" }))).toEqual(expected)
    expect(jsonOf(await on.call("memory", { operation: "search", query: "undo shipment", synonyms: [], note_line: "" }))).toEqual(expected)
  })

  for (const field of ["keywords", "related", "note_line"] as const) {
    test(`#given a note with no query word or synonym #when only ${field} matches #then the note is found and recorded for nudging`, async () => {
      const root = await tempRoot()
      const repo = await memoryRepo()
      await commitMemory(repo, "notes/coffee.md", "Coffee preferences.", "Coffee")
      const h = harness({ workspaceRoot: root, repo, queryExpansion: true })
      const search = { operation: "search", query: "undo shipment", synonyms: ["revert"] }
      expect(jsonOf(await h.call("memory", search)).results).toEqual([])

      const result = jsonOf(await h.call("memory", { ...search, [field]: field === "note_line" ? "Coffee preferences." : ["coffee"] }))
      expect((result.results as SearchHit[]).map((hit) => hit.path)).toEqual(["notes/coffee.md"])
      expect([...h.searchedPaths]).toEqual(["notes/coffee.md"])
    })
  }

  test("#given astral-plane text exactly at the character bounds #when added to a search #then every tier and note line is accepted", async () => {
    const { root, repo } = await seeded()
    const h = harness({ workspaceRoot: root, repo, queryExpansion: true })

    for (const added of [
      { synonyms: ["𠮷".repeat(MEMORY_EXPANSION_BOUNDS.termChars)] },
      { keywords: ["𠮷".repeat(MEMORY_EXPANSION_BOUNDS.termChars)] },
      { related: ["𠮷".repeat(MEMORY_EXPANSION_BOUNDS.termChars)] },
      { note_line: "𠮷".repeat(MEMORY_EXPANSION_BOUNDS.noteLineChars) },
    ]) {
      const result = await h.call("memory", { operation: "search", query: "undo shipment", ...added })
      expect(result.isError).toBeUndefined()
      expect((jsonOf(result).results as SearchHit[]).map((hit) => hit.path)).toEqual(["notes/deploy.md"])
    }
  })

  test("#given a non-array expansion tier #when searched #then the tool reports the shape problem and falls back to plain recall", async () => {
    const { root, repo } = await seeded()
    const h = harness({ workspaceRoot: root, repo, queryExpansion: true })

    for (const field of ["synonyms", "keywords", "related"]) {
      const result = await h.call("memory", { operation: "search", query: "undo shipment", [field]: "revert" })
      expect(result.isError).toBeUndefined()
      expect(jsonOf(result)).toMatchObject({
        expansion_fallback: `${field} is a list of terms.`,
        results: [{ path: "notes/deploy.md" }],
      })
    }
  })

  test("#given query expansion on #when added terms exceed the bounds #then the tool reports the problem and falls back to plain recall", async () => {
    const { root, repo } = await seeded()
    const h = harness({ workspaceRoot: root, repo, queryExpansion: true })

    for (const added of [
      { synonyms: Array.from({ length: 17 }, (_, index) => `term${index}`) },
      { keywords: ["k".repeat(81)] },
      { related: [""] },
      { related: "revert" },
      { note_line: "n".repeat(301) },
      { synonyms: ["𠮷".repeat(81)] },
      { note_line: "𠮷".repeat(301) },
    ]) {
      const result = await h.call("memory", { operation: "search", query: "undo shipment", ...added })
      expect(result.isError).toBeUndefined()
      expect(jsonOf(result)).toMatchObject({
        expansion_fallback: expect.any(String),
        results: [{ path: "notes/deploy.md" }],
      })
    }
  })
})
