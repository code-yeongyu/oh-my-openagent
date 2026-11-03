import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { installHooks, resolveHooksDir } from "../memfs/hooks"
import { PRE_COMMIT_HOOK_SCRIPT } from "../memfs/hooks-scripts"
import { runMemoryTool, type MemoryToolParams } from "./memory"
import { MemoryWriteRefusedError } from "./tool-errors"
import { removeTree } from "../../../../test-support/remove-tree"

// #12221: a memory repo created before #10488 keeps the pre-commit hook that release installed. Its key
// allowlist predates the `provenance` claim receipt (git log -S on hooks-scripts.ts: e9d02241f7^).
const PRE_10488_KEYS = 'ALL_KNOWN_KEYS="description read_only limit kind aliases"'
const STALE_PRE_COMMIT = PRE_COMMIT_HOOK_SCRIPT.replace(/^ALL_KNOWN_KEYS=.*$/m, PRE_10488_KEYS)
// A hook the user wrote: no omo marker. It refuses the claim receipt header and nothing else.
const FOREIGN_PRE_COMMIT = "#!/bin/sh\nif git diff --cached | grep -q '^+provenance:'; then echo 'my hook: no provenance'; exit 1; fi\nexit 0\n"

const AUTHOR: GitCommitAuthor = { agentId: "agent-stale-hook", authorName: "Stale Hook", authorEmail: "stale@example.com" }
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function oldRepo(preCommit: string): Promise<GitMemoryRepo> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-stale-hook-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  await write(repo, { command: "create", file_path: "system/self.md", description: "Self", file_text: "Prefers short answers." })
  installHooks(repo.dir)
  await writeFile(join(resolveHooksDir(repo.dir), "pre-commit"), preCommit, { mode: 0o755 })
  return repo
}

async function write(repo: GitMemoryRepo, params: Omit<MemoryToolParams, "author" | "reason">, claimed = false): Promise<void> {
  await runMemoryTool({
    repo,
    lock: async (_domain, operation) => operation(),
    params: {
      ...params,
      reason: `write ${params.command}`,
      author: AUTHOR,
      ...(claimed ? { provenance: { sessionId: "s", userTurns: 1, claim: { source: "agent", downgraded: true } } } : {}),
    },
  })
}

const EDIT = { command: "str_replace", file_path: "system/self.md", old_string: "short", new_string: "brief" } as const

describe("memory repo with a hook installed by an older omo (#12221)", () => {
  it("#given a stale omo pre-commit hook #when the memory tool stamps a claim receipt #then the hook is migrated and the write commits", async () => {
    const repo = await oldRepo(STALE_PRE_COMMIT)

    await write(repo, EDIT, true)

    expect(await readFile(join(repo.dir, "system/self.md"), "utf8")).toContain("provenance:")
    expect(await readFile(join(resolveHooksDir(repo.dir), "pre-commit"), "utf8")).toBe(PRE_COMMIT_HOOK_SCRIPT)
    expect(await repo.status()).toBe("")
  }, 30_000)

  it("#given a user's own pre-commit hook refuses a write #when the next unrelated write runs #then only the refused write failed and the hook is untouched", async () => {
    const repo = await oldRepo(FOREIGN_PRE_COMMIT)
    const before = await readFile(join(repo.dir, "system/self.md"), "utf8")

    const refused = await write(repo, EDIT, true).then(() => undefined, (error: unknown) => error)

    expect(refused).toBeInstanceOf(MemoryWriteRefusedError)
    expect((refused as MemoryWriteRefusedError).reason).toBe("commit_hook_refused")
    expect((refused as Error).message).toContain("my hook: no provenance")
    expect(await readFile(join(repo.dir, "system/self.md"), "utf8")).toBe(before)
    expect(await repo.status()).toBe("")
    await write(repo, { command: "create", file_path: "notes/other.md", description: "Other", file_text: "Unrelated." })
    expect((await repo.log({ limit: 1 }))[0]?.subject).toBe("write create")
    expect(await readFile(join(resolveHooksDir(repo.dir), "pre-commit"), "utf8")).toBe(FOREIGN_PRE_COMMIT)
  }, 30_000)
})
