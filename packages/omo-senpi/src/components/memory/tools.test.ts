import { afterEach, describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

import {
  GitMemoryRepo,
  acquireLock,
  buildIdentityPaths,
  createLockRecord,
  memoryWriterLockPath,
  parseMemoryFile,
  releaseLock,
  renderMemoryFile,
  type GitCommitAuthor,
} from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import {
  MEMORY_APPLY_PATCH_TOOL_NAME,
  MEMORY_TOOL_NAME,
  createMemoryTools,
  registerMemoryTools,
  type MemoryToolExecutionResult,
} from "./tools"

const exec = promisify(execFile)
const IDENTITY = "agent-memory-tools-test"
const AUTHOR: GitCommitAuthor = { agentId: IDENTITY, authorName: "Memory Tools Test Agent" }

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

interface BoundFixture {
  readonly context: MemoryIdentityContext
  readonly repo: GitMemoryRepo
  readonly locksDirectory: string
}

async function boundFixture(): Promise<BoundFixture> {
  const root = await mkdtemp(join(tmpdir(), "omo-senpi-memory-tools-"))
  roots.push(root)
  const identityPaths = buildIdentityPaths(root, IDENTITY)
  const repo = new GitMemoryRepo({ dir: identityPaths.repo, agentId: IDENTITY })
  await repo.init({ authorName: AUTHOR.authorName })
  const binding = createMemoryBinding({ identity: IDENTITY, repoPath: identityPaths.repo, boundAt: Date.now() })
  const context = createMemoryIdentityContext({ identity: IDENTITY, identityPaths, binding })
  return { context, repo, locksDirectory: identityPaths.locks }
}

async function seedFile(fixture: BoundFixture, path: string, body: string): Promise<void> {
  const fullPath = join(fixture.repo.dir, path)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, renderMemoryFile({ description: "Seed" }, body), "utf8")
  await fixture.repo.commitWrite([path], `seed ${path}`, AUTHOR)
}

async function git(repo: GitMemoryRepo, args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd: repo.dir })
  return String(result.stdout).trim()
}

function textOf(result: MemoryToolExecutionResult): string {
  const first = result.content[0]
  return first !== undefined && first.type === "text" ? first.text : ""
}

describe("memory tool registration", () => {
  test("#given a context resolver #when registerMemoryTools runs #then both tools are captured with sequential execution and prompt metadata", () => {
    // given
    const pi = new FakeExtensionAPI()

    // when
    registerMemoryTools(pi, () => undefined)

    // then
    const names = pi.tools.map((tool) => tool["name"])
    expect(names).toEqual([MEMORY_TOOL_NAME, MEMORY_APPLY_PATCH_TOOL_NAME])
    for (const tool of pi.tools) {
      expect(tool["executionMode"]).toBe("sequential")
      expect(typeof tool["label"]).toBe("string")
      expect(typeof tool["description"]).toBe("string")
      expect(typeof tool["promptSnippet"]).toBe("string")
      const guidelines = tool["promptGuidelines"]
      expect(Array.isArray(guidelines)).toBe(true)
      expect((guidelines as readonly unknown[]).length).toBeGreaterThan(0)
      expect(typeof tool["parameters"]).toBe("object")
      expect(typeof tool["execute"]).toBe("function")
    }
  })

  test("#given the memory tool description #when inspected #then it documents omo identity, frontmatter rules, and result strings", () => {
    // given
    const pi = new FakeExtensionAPI()
    registerMemoryTools(pi, () => undefined)

    // when
    const description = String(pi.tools[0]?.["description"] ?? "")

    // then
    expect(description).toContain("memory repo")
    expect(description).toContain("frontmatter")
    expect(description).toContain("read_only")
    expect(description).toContain("harness will sync after the turn")
  })
})

describe("memory tool activation", () => {
  test("#given no bound identity #when either tool executes #then an actionable initialization error is returned", async () => {
    // given
    const [memoryTool, applyPatchTool] = createMemoryTools(() => undefined)

    // when
    const memoryResult = await memoryTool.execute("call-1", { command: "create", reason: "x", file_path: "a.md", description: "d" })
    const patchResult = await applyPatchTool.execute("call-2", { reason: "x", input: "*** Begin Patch\n*** End Patch" })

    // then
    expect(memoryResult.isError).toBe(true)
    expect(textOf(memoryResult)).toContain("no memory identity bound")
    expect(textOf(memoryResult)).toContain("restart")
    expect(patchResult.isError).toBe(true)
    expect(textOf(patchResult)).toContain("no memory identity bound")
  })

  test("#given a resolver that binds after registration #when the tool executes #then activation follows binding", async () => {
    // given
    const fixture = await boundFixture()
    const holder: { current: MemoryIdentityContext | undefined } = { current: undefined }
    const [memoryTool] = createMemoryTools(() => holder.current)

    // when
    const stale = await memoryTool.execute("call-1", { command: "create", reason: "early", file_path: "a.md", description: "d" })
    holder.current = fixture.context
    const bound = await memoryTool.execute("call-2", { command: "create", reason: "Track a", file_path: "a.md", description: "d" })

    // then
    expect(stale.isError).toBe(true)
    expect(bound.isError).toBeUndefined()
  })
})

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
  })

  test("#given a bound identity #when memory_apply_patch executes #then the patch is applied and committed", async () => {
    // given
    const fixture = await boundFixture()
    await seedFile(fixture, "system/human/prefs/coding.md", "Use broad abstractions")
    const [, applyPatchTool] = createMemoryTools(() => fixture.context)
    const input = [
      "*** Begin Patch",
      "*** Update File: system/human/prefs/coding.md",
      "@@",
      "-Use broad abstractions",
      "+Prefer small focused helpers",
      "*** End Patch",
    ].join("\n")

    // when
    const result = await applyPatchTool.execute("call-1", { reason: "Refine coding preferences", input })

    // then
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toMatch(/^memory_apply_patch committed locally \([0-9a-f]{7}\)\.$/)
    const written = parseMemoryFile(await readFile(join(fixture.repo.dir, "system/human/prefs/coding.md"), "utf8"))
    expect(written.body).toContain("Prefer small focused helpers")
    expect(await git(fixture.repo, ["log", "-1", "--format=%s"])).toBe("Refine coding preferences")
  })

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
  })

  test("#given a bound identity #when memory_apply_patch receives a malformed patch #then the parse error maps to an error result", async () => {
    // given
    const fixture = await boundFixture()
    const [, applyPatchTool] = createMemoryTools(() => fixture.context)

    // when
    const result = await applyPatchTool.execute("call-1", { reason: "Broken", input: "definitely not a patch" })

    // then
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("memory_apply_patch:")
  })

  test("#given the writer lock is held #when a tool executes #then the contention surfaces as an error result", async () => {
    // given
    const fixture = await boundFixture()
    await fixture.context.repoAccess.ensureRuntimeDirs()
    const holder = await createLockRecord("contending test process")
    const lockPath = memoryWriterLockPath(fixture.locksDirectory)
    await acquireLock(lockPath, holder)
    const [memoryTool] = createMemoryTools(() => fixture.context, { lockWaitTimeoutMs: 50, lockRetryDelayMs: 10 })

    try {
      // when
      const result = await memoryTool.execute("call-1", {
        command: "create",
        reason: "Blocked write",
        file_path: "blocked.md",
        description: "d",
      })

      // then
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain("memory-write.lock")
    } finally {
      await releaseLock(lockPath, holder)
    }
  })

  test("#given concurrent executions #when both commit #then they serialize through the writer lock", async () => {
    // given
    const fixture = await boundFixture()
    const [memoryTool] = createMemoryTools(() => fixture.context)

    // when
    const [first, second] = await Promise.all([
      memoryTool.execute("call-1", { command: "create", reason: "Track a", file_path: "a.md", description: "a" }),
      memoryTool.execute("call-2", { command: "create", reason: "Track b", file_path: "b.md", description: "b" }),
    ])

    // then
    expect(first.isError).toBeUndefined()
    expect(second.isError).toBeUndefined()
    const subjects = (await git(fixture.repo, ["log", "-2", "--format=%s"])).split("\n").sort()
    expect(subjects).toEqual(["Track a", "Track b"])
    expect(await git(fixture.repo, ["status", "--porcelain"])).toBe("")
  })

  test("#given no repo exists yet #when the memory tool executes #then it lazily initializes with hooks and seeds", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-senpi-memory-lazy-init-"))
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
  })
})
