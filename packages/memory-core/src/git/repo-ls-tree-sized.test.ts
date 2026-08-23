import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GitExec, GitExecOptions, GitExecResult } from "./index"
import { createNodeGitExec, GitMemoryRepo } from "./index"

const tempDirs: string[] = []

async function createRepo(agentId = "agent-one") {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-ls-tree-sized-")))
  tempDirs.push(dir)
  return { dir, repo: new GitMemoryRepo({ dir, agentId }) }
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => undefined)
  }
})

describe("GitMemoryRepo.lsTreeSized", () => {
  it("#given a committed tree with blobs #when lsTreeSized runs #then each blob path and byte size is returned from one git call", async () => {
    // given
    const { dir } = await createRepo()
    const persona = "persona\n"
    const guide = "guide 🧠\n"
    const notes = "working notes\n"
    const calls: string[][] = []
    const inner = createNodeGitExec()
    const exec: GitExec = {
      async run(argv: readonly string[], options: GitExecOptions): Promise<GitExecResult> {
        calls.push([...argv])
        return inner.run(argv, options)
      },
    }
    const repo = new GitMemoryRepo({ dir, agentId: "agent-one", exec })
    await repo.init({
      seedFiles: [
        { relativePath: "system/persona.md", content: persona },
        { relativePath: "system/nested/guide.md", content: guide },
        { relativePath: "notes.md", content: notes },
      ],
    })
    calls.length = 0

    // when
    const entries = await repo.lsTreeSized()

    // then
    expect(entries).toEqual([
      { path: "notes.md", bytes: Buffer.byteLength(notes, "utf8") },
      { path: "system/nested/guide.md", bytes: Buffer.byteLength(guide, "utf8") },
      { path: "system/persona.md", bytes: Buffer.byteLength(persona, "utf8") },
    ])
    expect(calls.filter((argv) => argv[0] === "ls-tree")).toEqual([
      ["ls-tree", "-r", "-l", "-z", "HEAD"],
    ])
  })

  it("#given an empty commit #when lsTreeSized runs #then the listing is empty", async () => {
    // given
    const { repo } = await createRepo()
    await repo.init()

    // when
    const entries = await repo.lsTreeSized()

    // then
    expect(entries).toEqual([])
  })

  it("#given tree and gitlink records with dash sizes #when lsTreeSized parses #then only blob entries remain", async () => {
    // given
    const stdout = [
      "100644 blob 0123456789abcdef0123456789abcdef01234567       5\tkeep.md",
      "040000 tree 0123456789abcdef0123456789abcdef01234567       -\tsubdir",
      "160000 commit 0123456789abcdef0123456789abcdef01234567       -\tvendor/lib",
    ].join("\0") + "\0"
    const repo = new GitMemoryRepo({
      dir: "/tmp/memory-ls-tree-sized-unused",
      agentId: "agent-one",
      exec: {
        async run(): Promise<GitExecResult> {
          return { code: 0, stdout, stderr: "" }
        },
      },
    })

    // when
    const entries = await repo.lsTreeSized("HEAD")

    // then
    expect(entries).toEqual([{ path: "keep.md", bytes: 5 }])
  })
})
