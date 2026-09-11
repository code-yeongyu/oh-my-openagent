import { describe, expect, test } from "bun:test"

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
