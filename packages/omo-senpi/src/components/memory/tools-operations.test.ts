import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, buildIdentityPaths, parseMemoryFile } from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { createMemoryTools } from "./tools"
import { IDENTITY, boundFixture, git, roots, seedFile, textOf } from "./tools.test-support"
import { realpathSync } from "node:fs"

describe("memory tool execution", () => {
  test("#given a bound identity #when memory create executes #then the engine commits and reports the short sha", async () => {
    // given
    const fixture = await boundFixture()
    const [memoryTool] = createMemoryTools(() => fixture.context)

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "Track coding preferences",
      file_path: "system/human/prefs/coding.md",
      description: "The user's coding preferences.",
      file_text: "Adds type hints to all Python code.",
    })

    // then
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toMatch(/^Memory create committed locally \([0-9a-f]{7}\)\.$/)
    expect(result.details.message).toBe(textOf(result))
    const written = parseMemoryFile(await readFile(join(fixture.repo.dir, "system/human/prefs/coding.md"), "utf8"))
    expect(written.frontmatter.description).toBe("The user's coding preferences.")
    expect(written.body).toBe("Adds type hints to all Python code.")
    expect(await git(fixture.repo, ["log", "-1", "--format=%s"])).toBe("Track coding preferences")
    expect(await git(fixture.repo, ["status", "--porcelain"])).toBe("")
  }, 30_000)
  test("#given a bound identity #when the engine rejects the change #then the memory error maps to an error result", async () => {
    // given
    const fixture = await boundFixture()
    await seedFile(fixture, "reference/dup.md", "already here")
    const [memoryTool] = createMemoryTools(() => fixture.context)

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "Duplicate create",
      file_path: "reference/dup.md",
      description: "d",
    })

    // then
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("memory:")
    expect(textOf(result)).toContain("block already exists")
    expect(result.details.message).toBe(textOf(result))
  }, 30_000)
  test("#given no repo exists yet #when the memory tool executes #then it lazily initializes with hooks and seeds", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-senpi-memory-lazy-init-")))
    roots.push(root)
    const identityPaths = buildIdentityPaths(root, IDENTITY)
    const binding = createMemoryBinding({ identity: IDENTITY, repoPath: identityPaths.repo, boundAt: Date.now() })
    const context = createMemoryIdentityContext({ identity: IDENTITY, identityPaths, binding })
    const [memoryTool] = createMemoryTools(() => context)

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "First memory",
      file_path: "system/facts.md",
      description: "qa fact",
      file_text: "senpi is a pi harness",
    })

    // then
    expect(result.isError).toBeUndefined()
    const repo = new GitMemoryRepo({ dir: identityPaths.repo, agentId: IDENTITY })
    expect(await repo.head()).not.toBeNull()
    const subjects = await git(repo, ["log", "--format=%s", "HEAD"])
    expect(subjects).toContain("chore: initialize local memory")
    expect(subjects).toContain("First memory")
    expect(await git(repo, ["show", "HEAD~1:system/persona.md"])).toContain("description:")
    const { existsSync } = await import("node:fs")
    expect(existsSync(join(identityPaths.repo, ".git", "hooks", "pre-commit"))).toBe(true)
    expect(existsSync(join(identityPaths.repo, ".git", "hooks", "post-commit"))).toBe(true)
  }, 30_000)
})

describe("memory tool onCommit seam", () => {
  test("#given a bound identity #when memory create commits #then onCommit receives the sha, first-line subject, and affected paths", async () => {
    // given
    const fixture = await boundFixture()
    const commits: Array<{ sha: string; subject: string; affectedPaths: readonly string[] }> = []
    const [memoryTool] = createMemoryTools(() => fixture.context, {
      onCommit: (commit) => commits.push(commit),
    })

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "rewrite the persona",
      file_path: "system/persona.md",
      description: "Persona",
      file_text: "v2 soul",
    })

    // then
    expect(result.isError).toBeUndefined()
    expect(commits).toEqual([{
      sha: (await fixture.repo.head()) ?? "",
      subject: "rewrite the persona",
      affectedPaths: ["system/persona.md"],
    }])
  }, 30_000)
  test("#given an engine rejection #when the tool executes #then onCommit is not called", async () => {
    // given
    const fixture = await boundFixture()
    const commits: Array<{ sha: string; subject: string; affectedPaths: readonly string[] }> = []
    const [memoryTool] = createMemoryTools(() => fixture.context, {
      onCommit: (commit) => commits.push(commit),
    })

    // when
    const result = await memoryTool.execute("call-3", {
      command: "str_replace",
      reason: "missing target",
      file_path: "system/persona.md",
      old_string: "nothing",
      new_string: "something",
    })

    // then
    expect(result.isError).toBe(true)
    expect(commits).toHaveLength(0)
  }, 30_000)
})
