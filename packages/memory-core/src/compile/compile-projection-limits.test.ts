import { describe, expect, it } from "bun:test"
import { createNodeGitExec } from "../git"
import { MemoryBlockCache } from "./cache"
import { compileMemoryBlock, externalProjectionStatsAt } from "./compile"
import { memory, repoWith } from "./compile.test-support"

async function commitAt(dir: string, path: string, content: string, iso: string): Promise<void> {
  const { writeFile, mkdir } = await import("node:fs/promises")
  const { dirname, join } = await import("node:path")
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), content)
  const env = { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso }
  const git = createNodeGitExec()
  await git.run(["add", "-A"], { cwd: dir, timeoutMs: 30_000, env })
  await git.run(["commit", "-q", "-m", `write ${path}`], { cwd: dir, timeoutMs: 30_000, env })
}

const projectionLine = (block: string, directory: string): string | undefined =>
  block.split("\n").find((line) => line.startsWith(`${directory}: `))

describe("compileMemoryBlock projection limits", () => {
  it("#given no limits passed #when compiled #then the default cap keeps the newest forty names per directory", async () => {
    // given
    const notes = Array.from({ length: 41 }, (_, index) => ({
      relativePath: `reference/n${String(index).padStart(2, "0")}.md`,
      content: memory(`N${index}`, "x"),
    }))
    const { dir, repo } = await repoWith([{ relativePath: "system/human.md", content: memory("Human", "Person") }, ...notes])
    await commitAt(dir, "reference/n40.md", memory("N40", "rewritten"), "2099-01-01T00:00:00Z")

    // when
    const block = await compileMemoryBlock(repo, { agentId: "a" })

    // then
    const line = projectionLine(block, "reference/") ?? ""
    expect(line.startsWith("reference/: n40.md, n00.md, n01.md")).toBe(true)
    expect(line.endsWith(", n38.md (+1 more; read $MEMORY_DIR/reference/ to list)")).toBe(true)
  })

  it("#given limits of zero #when compiled #then every name is listed in name order", async () => {
    // given
    const { dir, repo } = await repoWith([{ relativePath: "system/human.md", content: memory("Human", "Person") }])
    await commitAt(dir, "reference/b.md", memory("B", "x"), "2026-01-01T00:00:01Z")
    await commitAt(dir, "reference/a.md", memory("A", "x"), "2026-01-01T00:00:02Z")

    // when
    const block = await compileMemoryBlock(repo, { agentId: "a", projection: { maxEntriesPerDirectory: 0, maxBytes: 0 } })

    // then
    expect(projectionLine(block, "reference/")).toBe("reference/: a.md, b.md")
  })

  it("#given commit times that cannot be read #when compiled with limits #then the block still compiles, capped in name order", async () => {
    // given
    const { dir, repo } = await repoWith([{ relativePath: "system/human.md", content: memory("Human", "Person") }])
    await commitAt(dir, "reference/b.md", memory("B", "x"), "2026-01-01T00:00:01Z")
    await commitAt(dir, "reference/a.md", memory("A", "x"), "2026-01-01T00:00:02Z")
    repo.pathCommitTimes = async () => { throw new Error("git log timed out") }

    // when
    const block = await compileMemoryBlock(repo, { agentId: "a", projection: { maxEntriesPerDirectory: 1, maxBytes: 0 } })

    // then
    expect(block).toContain("Person")
    expect(projectionLine(block, "reference/")).toBe("reference/: a.md (+1 more; read $MEMORY_DIR/reference/ to list)")
  })

  it("#given commit times that cannot be read #when the projection is measured #then the stats say the names fell back to name order", async () => {
    // given
    const { dir, repo } = await repoWith([{ relativePath: "system/human.md", content: memory("Human", "Person") }])
    await commitAt(dir, "reference/a.md", memory("A", "x"), "2026-01-01T00:00:01Z")
    const head = await repo.head()
    if (head === null) throw new Error("expected a head")
    const readable = await externalProjectionStatsAt(repo, head, { maxEntriesPerDirectory: 1, maxBytes: 0 })
    repo.pathCommitTimes = async () => { throw new Error("git log timed out") }

    // when
    const unreadable = await externalProjectionStatsAt(repo, head, { maxEntriesPerDirectory: 1, maxBytes: 0 })

    // then
    expect(readable.recencyUnavailable).toBe(false)
    expect(unreadable.recencyUnavailable).toBe(true)
  })

  it("#given two different limits at one revision #when cached #then each gets its own entry and its own bytes", async () => {
    // given
    const { dir, repo } = await repoWith([{ relativePath: "system/human.md", content: memory("Human", "Person") }])
    await commitAt(dir, "reference/a.md", memory("A", "x"), "2026-01-01T00:00:01Z")
    await commitAt(dir, "reference/b.md", memory("B", "x"), "2026-01-01T00:00:02Z")
    const cache = new MemoryBlockCache()

    // when
    const capped = await cache.compile(repo, "t", { agentId: "a", projection: { maxEntriesPerDirectory: 1, maxBytes: 0 } })
    const open = await cache.compile(repo, "t", { agentId: "a", projection: { maxEntriesPerDirectory: 0, maxBytes: 0 } })
    const cappedAgain = await cache.compile(repo, "t", { agentId: "a", projection: { maxEntriesPerDirectory: 1, maxBytes: 0 } })

    // then
    expect(cache.size).toBe(2)
    expect(projectionLine(capped, "reference/")).toBe("reference/: b.md (+1 more; read $MEMORY_DIR/reference/ to list)")
    expect(projectionLine(open, "reference/")).toBe("reference/: a.md, b.md")
    expect(cappedAgain).toBe(capped)
  })
})
