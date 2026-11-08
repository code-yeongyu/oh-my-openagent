import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec, GitMemoryRepo } from "../git"
import { parseMemoryFile } from "../memfs"
import { buildDefaultSeedFiles } from "../seeds"
import { applyFactsBatch } from "./extraction"
import { removeTree } from "../../../../test-support/remove-tree"

const AUTHOR = { agentId: "facts-agent", authorName: "Facts Extractor" }
const exec = createNodeGitExec()
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function fixture(): Promise<{ readonly dir: string; readonly repo: GitMemoryRepo }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-facts-retired-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await repo.init({ seedFiles: buildDefaultSeedFiles() })
  return { dir, repo }
}

async function retire(dir: string, path: string): Promise<void> {
  for (const argv of [["rm", "-q", "--", path], ["-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-qm", `chore(dream): archive ${path}`]]) {
    const result = await exec.run(argv, { cwd: dir, timeoutMs: 30_000 })
    if (result.code !== 0) throw new Error(result.stderr)
  }
}

let batch = 0
async function extract(repo: GitMemoryRepo, text: string, date: string): Promise<void> {
  batch += 1
  const result = await applyFactsBatch(repo, {
    batchId: `11111111-1111-4111-8111-${String(batch).padStart(12, "0")}`,
    records: [{ scope: "project", text, date }],
  }, AUTHOR)
  expect(result.outcome).toBe("committed")
}

describe("facts never reuse a retired ledger path (#12642)", () => {
  test("#given an archived month ledger #when the same month gets new facts #then they go to one successor ledger and the archived path stays gone", async () => {
    // given
    const { dir, repo } = await fixture()
    await extract(repo, "The build uses Bun.", "2026-10-01")
    await retire(dir, "notes/facts/2026-10.md")

    // when
    await extract(repo, "The release moved to Friday.", "2026-10-20")
    await extract(repo, "Reviews need one approval.", "2026-10-21")

    // then
    expect(existsSync(join(dir, "notes/facts/2026-10.md"))).toBe(false)
    const successor = parseMemoryFile(await readFile(join(dir, "notes/facts/2026-10-2.md"), "utf8"))
    expect(successor.frontmatter.description).toBe("Explicit facts for 2026-10")
    expect(successor.body).toBe("- [2026-10-20] The release moved to Friday.\n- [2026-10-21] Reviews need one approval.\n")
  }, 30_000)

  test("#given the successor ledger was archived too #when the month gets new facts #then the next unused successor is created", async () => {
    // given
    const { dir, repo } = await fixture()
    await extract(repo, "First.", "2026-10-01")
    await retire(dir, "notes/facts/2026-10.md")
    await extract(repo, "Second.", "2026-10-02")
    await retire(dir, "notes/facts/2026-10-2.md")

    // when
    await extract(repo, "Third.", "2026-10-03")

    // then
    expect(existsSync(join(dir, "notes/facts/2026-10.md"))).toBe(false)
    expect(existsSync(join(dir, "notes/facts/2026-10-2.md"))).toBe(false)
    expect(parseMemoryFile(await readFile(join(dir, "notes/facts/2026-10-3.md"), "utf8")).body).toBe("- [2026-10-03] Third.\n")
  }, 30_000)
})
