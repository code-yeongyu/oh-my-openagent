import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { renderMemoryFile } from "../memfs/frontmatter"
import { removeTree } from "../../../../test-support/remove-tree"
import { adoptExternalEdits } from "./adopt-external"
import { runMemoryTool, type MemoryToolLock } from "./memory"

const AUTHOR: GitCommitAuthor = { agentId: "agent-adopt", authorName: "Adopt" }
const lock: MemoryToolLock = async (_domain, operation) => operation()

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function seededRepo(): Promise<GitMemoryRepo> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-adopt-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  for (const path of ["system/human.md", "notes/old.md"]) {
    await mkdir(dirname(join(repo.dir, path)), { recursive: true })
    await writeFile(join(repo.dir, path), renderMemoryFile({ description: "Seed" }, `${path}\n`), "utf8")
  }
  await repo.commitWrite(["system/human.md", "notes/old.md"], "seed", AUTHOR)
  return repo
}

describe("adopting edits another writer left in the memory repo (#15411)", () => {
  it("#given an append, a new file and a delete made outside the tool #when adopted #then one attributed commit holds them and tool writes work again", async () => {
    // given
    const repo = await seededRepo()
    await writeFile(join(repo.dir, "system/human.md"), "appended by another process\n", { flag: "a" })
    await writeFile(join(repo.dir, "notes/new.md"), renderMemoryFile({ description: "New" }, "new\n"), "utf8")
    await rm(join(repo.dir, "notes/old.md"))

    // when
    const result = await adoptExternalEdits({ repo, lock, author: AUTHOR, sessionId: "session-1" })
    const write = await runMemoryTool({
      repo,
      lock,
      params: { command: "create", reason: "after adopt", file_path: "notes/after.md", description: "After", file_text: "x", author: AUTHOR },
    })

    // then
    expect(result).toMatchObject({ status: "adopted", paths: ["notes/new.md", "notes/old.md", "system/human.md"] })
    const adopted = (await repo.log({ limit: 2 }))[1]
    expect(adopted?.subject).toBe("chore(memory): adopt external edit")
    expect(adopted?.trailers["Omo-Writer"]).toBe("external")
    expect(adopted?.trailers["Omo-External-Paths"]).toBe("notes/new.md, notes/old.md, system/human.md")
    expect(await repo.show("HEAD", "system/human.md")).toContain("appended by another process")
    expect(write.commit?.affectedPaths).toEqual(["notes/after.md"])
    expect(await repo.status()).toBe("")
  })

  it("#given a clean repo #when adopted #then nothing is committed", async () => {
    // given
    const repo = await seededRepo()
    const head = await repo.head()

    // when
    const result = await adoptExternalEdits({ repo, lock, author: AUTHOR })

    // then
    expect(result).toEqual({ status: "clean" })
    expect(await repo.head()).toBe(head)
  })

  it("#given a foreign edit holding a secret-like value #when adopted #then it is refused and the file stays exactly as it was, unstaged", async () => {
    // given
    const repo = await seededRepo()
    const secret = `token ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}\n`
    await writeFile(join(repo.dir, "system/human.md"), secret, { flag: "a" })
    const before = await readFile(join(repo.dir, "system/human.md"), "utf8")
    const head = await repo.head()

    // when
    const failure = await adoptExternalEdits({ repo, lock, author: AUTHOR }).catch((error: unknown) => error)

    // then
    expect(String(failure)).toContain("adopting the external edit was refused")
    expect(await repo.head()).toBe(head)
    expect(await readFile(join(repo.dir, "system/human.md"), "utf8")).toBe(before)
    expect(await repo.status()).toBe(" M system/human.md\n")
    expect(existsSync(join(repo.dir, "system/human.md"))).toBe(true)
  })
})
