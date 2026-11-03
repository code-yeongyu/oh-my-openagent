import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { parseMemoryFile } from "../memfs/frontmatter"
import { PROVENANCE_STRIPPED_TRAILER, readHeader } from "./claim-frontmatter"
import { runMemoryTool, type MemoryToolParams } from "./memory"
import { runMemoryApplyPatch } from "./memory-apply-patch"
import { removeTree } from "../../../../test-support/remove-tree"

const AUTHOR: GitCommitAuthor = { agentId: "agent-legacy-test", authorName: "Legacy Test", authorEmail: "legacy@example.com" }
const LEGACY = '"user said \\"yes\\" approving proposal 0123456789abcdef (body sha256:0123456789abcdef)"'
const PROVENANCE = { sessionId: "s", userTurns: 1 } as const
const lock = async <T>(_domain: unknown, operation: () => Promise<T>): Promise<T> => operation()
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function seeded(): Promise<GitMemoryRepo> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-legacy-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  await writeFile(join(repo.dir, "legacy.md"), `---\ndescription: Legacy\nprovenance: ${LEGACY}\n---\n\nTheme: light.\n`)
  await repo.commitWrite(["legacy.md"], "legacy note\n\nOmo-Writer: memory-tool", AUTHOR)
  return repo
}

const run = (repo: GitMemoryRepo, params: Omit<MemoryToolParams, "author" | "reason">) =>
  runMemoryTool({ repo, lock, params: { ...params, reason: `write ${params.command}`, author: AUTHOR, provenance: PROVENANCE } })

async function headerAt(repo: GitMemoryRepo, path: string): Promise<string | undefined> {
  return readHeader(parseMemoryFile(await readFile(join(repo.dir, path), "utf8")).frontmatter)
}

// Every Omo-Provenance-Stripped line of the latest commit (the parsed trailer map keeps only one value per key).
async function strippedLines(repo: GitMemoryRepo): Promise<string[]> {
  const body = (await repo.log({ limit: 1 }))[0]?.body ?? ""
  return body.split("\n").filter((line) => line.startsWith(`${PROVENANCE_STRIPPED_TRAILER}: `)).map((line) => line.slice(PROVENANCE_STRIPPED_TRAILER.length + 2))
}

async function lastTrailer(repo: GitMemoryRepo): Promise<string | undefined> {
  return (await repo.log({ limit: 1 }))[0]?.trailers[PROVENANCE_STRIPPED_TRAILER]
}

describe("memory tool: a legacy user header is dropped on edit and the drop is recorded (lead decision C on #10498)", () => {
  it("#given a legacy note #when str_replace edits it #then the header is gone and the commit records the path", async () => {
    const repo = await seeded()
    await run(repo, { command: "str_replace", file_path: "legacy.md", old_string: "light", new_string: "dark" })
    expect(await headerAt(repo, "legacy.md")).toBeUndefined()
    expect(await lastTrailer(repo)).toBe("legacy.md")
  }, 30_000)

  it("#given a legacy note #when update_description rewrites it #then the header is gone and the commit records the path", async () => {
    const repo = await seeded()
    await run(repo, { command: "update_description", file_path: "legacy.md", description: "Theme notes" })
    expect(await headerAt(repo, "legacy.md")).toBeUndefined()
    expect(await lastTrailer(repo)).toBe("legacy.md")
  }, 30_000)

  it("#given a legacy note #when memory_apply_patch updates it #then the header is gone and the commit records the path", async () => {
    const repo = await seeded()
    await runMemoryApplyPatch({ repo, lock, params: { reason: "patch", author: AUTHOR, provenance: PROVENANCE, input: "*** Begin Patch\n*** Update File: legacy.md\n@@\n-Theme: light.\n+Theme: dark.\n*** End Patch" } })
    expect(await headerAt(repo, "legacy.md")).toBeUndefined()
    expect(await lastTrailer(repo)).toBe("legacy.md")
  }, 30_000)

  it("#given a legacy note #when it is renamed #then the new path has no header and the commit records the source path", async () => {
    const repo = await seeded()
    await run(repo, { command: "rename", old_path: "legacy.md", new_path: "moved.md" })
    expect(await headerAt(repo, "moved.md")).toBeUndefined()
    expect(await lastTrailer(repo)).toBe("legacy.md")
  }, 30_000)

  it("#given a legacy note #when a patch moves it onto an existing file (both patch paths) #then the moved header is dropped and recorded under the source path", async () => {
    for (const via of ["memory_apply_patch", "memory apply_patch"] as const) {
      const repo = await seeded()
      await writeFile(join(repo.dir, "plain.md"), "---\ndescription: Plain\n---\n\nold plain body\n")
      await repo.commitWrite(["plain.md"], "plain\n\nOmo-Writer: memory-tool", AUTHOR)
      const input = "*** Begin Patch\n*** Update File: legacy.md\n*** Move to: plain.md\n@@\n-Theme: light.\n+Theme: dark.\n*** End Patch"
      if (via === "memory_apply_patch") await runMemoryApplyPatch({ repo, lock, params: { reason: "patch", author: AUTHOR, provenance: PROVENANCE, input } })
      else await run(repo, { command: "apply_patch", input })
      expect({ via, header: await headerAt(repo, "plain.md") }).toEqual({ via, header: undefined })
      expect({ via, recorded: await strippedLines(repo) }).toEqual({ via, recorded: ["legacy.md"] })
    }
  }, 60_000)

  it("#given a legacy note #when a patch moves another legacy note onto it #then both drops are recorded, source and overwritten destination", async () => {
    const repo = await seeded()
    await writeFile(join(repo.dir, "other.md"), `---\ndescription: Other\nprovenance: ${LEGACY}\n---\n\nTheme: blue.\n`)
    await repo.commitWrite(["other.md"], "other\n\nOmo-Writer: memory-tool", AUTHOR)
    await runMemoryApplyPatch({ repo, lock, params: { reason: "patch", author: AUTHOR, provenance: PROVENANCE, input: "*** Begin Patch\n*** Update File: other.md\n*** Move to: legacy.md\n@@\n-Theme: blue.\n+Theme: green.\n*** End Patch" } })
    expect(await headerAt(repo, "legacy.md")).toBeUndefined()
    expect((await strippedLines(repo)).sort()).toEqual(["legacy.md", "other.md"])
  }, 30_000)

  it("#given a legacy note #when a patch deletes it beside an unrelated add #then nothing is recorded (a delete is not an edit)", async () => {
    const repo = await seeded()
    await runMemoryApplyPatch({ repo, lock, params: { reason: "patch", author: AUTHOR, provenance: PROVENANCE, input: "*** Begin Patch\n*** Delete File: legacy.md\n*** Add File: brand-new.md\n+---\n+description: New\n+---\n+\n+new body\n*** End Patch" } })
    expect(await strippedLines(repo)).toEqual([])
  }, 30_000)

  it("#given a path freed earlier in the same patch (delete, or moved away in a rotate) #when another note moves onto it (both patch paths) #then the patch applies and only the legacy source is recorded", async () => {
    const shapes = {
      "delete then move": "*** Begin Patch\n*** Delete File: legacy.md\n*** Update File: plain.md\n*** Move to: legacy.md\n@@\n-old plain body\n+new plain body\n*** End Patch",
      rotate: "*** Begin Patch\n*** Update File: legacy.md\n*** Move to: parked.md\n@@\n-Theme: light.\n+Theme: dark.\n*** Update File: plain.md\n*** Move to: legacy.md\n@@\n-old plain body\n+new plain body\n*** End Patch",
    } as const
    const expected = { "delete then move": [], rotate: ["legacy.md"] } as const
    for (const [shape, input] of Object.entries(shapes) as [keyof typeof shapes, string][]) {
      for (const via of ["memory_apply_patch", "memory apply_patch"] as const) {
        const repo = await seeded()
        await writeFile(join(repo.dir, "plain.md"), "---\ndescription: Plain\n---\n\nold plain body\n")
        await repo.commitWrite(["plain.md"], "plain\n\nOmo-Writer: memory-tool", AUTHOR)
        if (via === "memory_apply_patch") await runMemoryApplyPatch({ repo, lock, params: { reason: "patch", author: AUTHOR, provenance: PROVENANCE, input } })
        else await run(repo, { command: "apply_patch", input })
        expect({ shape, via, body: parseMemoryFile(await readFile(join(repo.dir, "legacy.md"), "utf8")).body.trim() }).toEqual({ shape, via, body: "new plain body" })
        expect({ shape, via, recorded: await strippedLines(repo) }).toEqual({ shape, via, recorded: [...expected[shape]] })
      }
    }
  }, 120_000)

  it("#given a destination that is not valid UTF-8 #when a patch moves a legacy note onto it #then the move overwrites it as before and records the source", async () => {
    const repo = await seeded()
    await writeFile(join(repo.dir, "binary.md"), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a]))
    await repo.commitWrite(["binary.md"], "binary\n\nOmo-Writer: memory-tool", AUTHOR)
    await runMemoryApplyPatch({ repo, lock, params: { reason: "patch", author: AUTHOR, provenance: PROVENANCE, input: "*** Begin Patch\n*** Update File: legacy.md\n*** Move to: binary.md\n@@\n-Theme: light.\n+Theme: dark.\n*** End Patch" } })
    expect(parseMemoryFile(await readFile(join(repo.dir, "binary.md"), "utf8")).body.trim()).toBe("Theme: dark.")
    expect(await strippedLines(repo)).toEqual(["legacy.md"])
  }, 30_000)

  it("#given a legacy note #when it is deleted #then nothing is recorded (a delete is not an edit)", async () => {
    const repo = await seeded()
    await run(repo, { command: "delete", file_path: "legacy.md" })
    expect(await lastTrailer(repo)).toBeUndefined()
  }, 30_000)
})
