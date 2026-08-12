import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { renderMemoryFile } from "../memfs/frontmatter"
import { MEMORY_SOUL_EDIT_RESULT_TOKEN } from "../soul"
import { runMemoryApplyPatch } from "./memory-apply-patch"
import { runMemoryTool, type MemoryToolLock } from "./memory"
import { realpathSync } from "node:fs"

const AUTHOR: GitCommitAuthor = {
  agentId: "agent-soul-edit-test",
  authorName: "Soul Edit Test Agent",
}

const roots: string[] = []
const WINDOWS_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixture(): Promise<{ repo: GitMemoryRepo; lock: MemoryToolLock }> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-soul-edit-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  const lock: MemoryToolLock = async (_domain, operation) => operation()
  return { repo, lock }
}

async function seed(
  setup: Awaited<ReturnType<typeof fixture>>,
  path: string,
  text: string,
): Promise<void> {
  const fullPath = join(setup.repo.dir, path)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, renderMemoryFile({ description: "Seed" }, text), "utf8")
  await setup.repo.commitWrite([path], `seed ${path}`, AUTHOR)
}

describe("runMemoryTool soul-edit result", () => {
  it("#given a create committed under system/persona.md #when the tool runs #then the result carries the commit metadata and the soul-edit directive", async () => {
    // given
    const setup = await fixture()

    // when
    const result = await runMemoryTool({
      repo: setup.repo,
      lock: setup.lock,
      params: {
        command: "create",
        reason: "rewrite my persona",
        file_path: "system/persona.md",
        description: "Persona",
        file_text: "I am v2.",
        author: AUTHOR,
      },
    })

    // then
    expect(result.message).toContain(MEMORY_SOUL_EDIT_RESULT_TOKEN)
    expect(result.commit).toBeDefined()
    expect(result.commit?.affectedPaths).toEqual(["system/persona.md"])
    expect(result.commit?.subject).toBe("rewrite my persona")
    expect(result.commit?.sha).toBe((await setup.repo.head()) ?? undefined)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given a str_replace on system/identity.md #when the tool runs #then the soul-edit directive appears", async () => {
    // given
    const setup = await fixture()
    await seed(setup, "system/identity.md", "- Name: Ada\n")

    // when
    const result = await runMemoryTool({
      repo: setup.repo,
      lock: setup.lock,
      params: {
        command: "str_replace",
        reason: "rename the creature",
        file_path: "system/identity.md",
        old_string: "Ada",
        new_string: "Grace",
        author: AUTHOR,
      },
    })

    // then
    expect(result.message).toContain(MEMORY_SOUL_EDIT_RESULT_TOKEN)
    expect(result.commit?.affectedPaths).toEqual(["system/identity.md"])
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given a rename that moves system/persona.md #when the tool runs #then the soul-edit directive appears", async () => {
    // given
    const setup = await fixture()
    await seed(setup, "system/persona.md", "old soul\n")

    // when
    const result = await runMemoryTool({
      repo: setup.repo,
      lock: setup.lock,
      params: {
        command: "rename",
        reason: "archive the old persona",
        old_path: "system/persona.md",
        new_path: "reference/old-persona.md",
        author: AUTHOR,
      },
    })

    // then
    expect(result.message).toContain(MEMORY_SOUL_EDIT_RESULT_TOKEN)
    expect(result.commit?.affectedPaths).toEqual(["system/persona.md", "reference/old-persona.md"])
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given a commit that touches only non-soul files #when the tool runs #then no soul-edit directive appears but commit metadata is present", async () => {
    // given
    const setup = await fixture()

    // when
    const result = await runMemoryTool({
      repo: setup.repo,
      lock: setup.lock,
      params: {
        command: "create",
        reason: "record a fact",
        file_path: "notes/facts/2026-08.md",
        description: "Facts",
        file_text: "- likes tea",
        author: AUTHOR,
      },
    })

    // then
    expect(result.message).not.toContain(MEMORY_SOUL_EDIT_RESULT_TOKEN)
    expect(result.commit?.affectedPaths).toEqual(["notes/facts/2026-08.md"])
    expect(result.commit?.subject).toBe("record a fact")
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)
})

describe("runMemoryApplyPatch soul-edit result", () => {
  it("#given a patch updating system/persona.md #when applied #then the result carries the soul-edit directive and commit metadata", async () => {
    // given
    const setup = await fixture()
    await seed(setup, "system/persona.md", "version one\n")

    // when
    const result = await runMemoryApplyPatch({
      repo: setup.repo,
      lock: setup.lock,
      params: {
        reason: "evolve persona",
        input: [
          "*** Begin Patch",
          "*** Update File: system/persona.md",
          "@@",
          "-version one",
          "+version two",
          "*** End Patch",
        ].join("\n"),
        author: AUTHOR,
      },
    })

    // then
    expect(result.message).toContain(MEMORY_SOUL_EDIT_RESULT_TOKEN)
    expect(result.commit?.affectedPaths).toEqual(["system/persona.md"])
    expect(result.commit?.subject).toBe("evolve persona")
    expect(result.commit?.sha).toBe((await setup.repo.head()) ?? undefined)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given a patch adding a non-soul file #when applied #then no soul-edit directive appears", async () => {
    // given
    const setup = await fixture()

    // when
    const result = await runMemoryApplyPatch({
      repo: setup.repo,
      lock: setup.lock,
      params: {
        reason: "add reference note",
        input: [
          "*** Begin Patch",
          "*** Add File: reference/note.md",
          "+---",
          "+description: Note",
          "+---",
          "+plain note",
          "*** End Patch",
        ].join("\n"),
        author: AUTHOR,
      },
    })

    // then
    expect(result.message).not.toContain(MEMORY_SOUL_EDIT_RESULT_TOKEN)
    expect(result.commit?.affectedPaths).toEqual(["reference/note.md"])
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)
})
